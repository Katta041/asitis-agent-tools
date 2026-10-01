// Supply-chain and packaging guarantees, plugin consistency, and copy rules.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { VERSION } from "../src/version.js";
import { BUNDLE, connect, MARKETPLACE, PKG, PLUGIN, REPO } from "./helpers.js";

// npm and claude are .cmd shims on Windows, which spawnSync only runs through a shell.
const SHELL = process.platform === "win32";

const pkg = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
const read = (p: string): string => readFileSync(p, "utf8");
const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

/**
 * Runs npm portably. On Windows `npm` is `npm.cmd`, which spawnSync cannot start without a
 * shell (status null). Under `npm test`, npm_execpath names npm's JS entry point, so run it
 * with this Node; otherwise fall back to a shell only for this call.
 */
function npm(args: string[], cwd: string): SpawnSyncReturns<string> {
  const cli = process.env["npm_execpath"];
  if (cli && /\.[cm]?js$/.test(cli)) return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return spawnSync("npm", args, { cwd, encoding: "utf8", shell: SHELL });
}

function files(dir: string, skip: (p: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip(p)) continue;
    if (e.isDirectory()) out.push(...files(p, skip));
    else out.push(p);
  }
  return out;
}

describe("npm package", () => {
  test("zero runtime dependencies and no install scripts", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.optionalDependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
    for (const s of ["preinstall", "install", "postinstall", "prepare"]) expect(pkg.scripts?.[s], s).toBeUndefined();
  });
  test("every dev dependency is pinned to an exact version, SDK included", () => {
    for (const [name, v] of Object.entries(pkg.devDependencies as Record<string, string>)) expect(v, name).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies["@modelcontextprotocol/sdk"]).toBe("1.31.0");
  });
  test("version constant matches package.json", () => expect(VERSION).toBe(pkg.version));
  test("provenance on, public access", () => expect(pkg.publishConfig).toEqual({ access: "public", provenance: true }));
  test("the published tarball contains only the bundle, notices and docs", () => {
    const r = npm(["pack", "--dry-run", "--json", "--ignore-scripts"], PKG);
    expect(r.error, "npm could not be started").toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    const listed = (JSON.parse(r.stdout)[0].files as Array<{ path: string }>).map((f) => f.path).sort();
    expect(listed).toEqual(["CHANGELOG.md", "LICENSE", "README.md", "dist/THIRD_PARTY_NOTICES.md", "dist/asitis-mcp.mjs", "package.json"]);
  });
});

describe("no write, exec or network code", () => {
  const FORBIDDEN_SRC = [
    /child_process/, /node:net\b/, /node:http/, /node:https/, /node:dns/, /node:tls/, /node:dgram/, /worker_threads/, /\bfetch\s*\(/,
    /\b(writeFile|appendFile|mkdir|mkdtemp|rm|rmdir|unlink|rename|copyFile|cp|symlink|link|chmod|chown|lchown|utimes|lutimes|truncate|ftruncate)(Sync)?\s*\((?!s\))/,
    /createWriteStream/, /O_WRONLY|O_RDWR|O_CREAT|O_APPEND/, /\beval\s*\(/, /\bFunction\s*\(/,
  ];
  test.each(readdirSync(path.join(PKG, "src")))("src/%s", (f) => {
    const src = read(path.join(PKG, "src", f));
    for (const re of FORBIDDEN_SRC) expect(src, `${f} matches ${re}`).not.toMatch(re);
  });
  test("the bundle imports no network or process modules", () => {
    const b = read(BUNDLE);
    for (const m of ["child_process", "net", "http", "https", "http2", "dns", "tls", "dgram", "worker_threads", "cluster"]) {
      expect(b, m).not.toMatch(new RegExp(`(from\\s*["']|require\\(["'])(node:)?${m}["']`));
    }
  });
  test("the guard hook only reads", () => {
    const h = read(path.join(PLUGIN, "hooks/guard.mjs"));
    expect([...h.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["node:fs", "node:path"]);
    for (const re of [/writeFile/, /child_process/, /fetch\(/, /unlink/, /rename/]) expect(h).not.toMatch(re);
  });
});

describe("Claude Code plugin", () => {
  const manifest = JSON.parse(read(path.join(PLUGIN, ".claude-plugin/plugin.json")));
  const market = JSON.parse(read(MARKETPLACE));
  const mcp = JSON.parse(read(path.join(PLUGIN, ".mcp.json")));
  const hooks = JSON.parse(read(path.join(PLUGIN, "hooks/hooks.json")));

  test("versions agree everywhere", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(market.plugins[0].version).toBe(pkg.version);
    expect(read(path.join(PLUGIN, "server/VERSION"))).toMatch(new RegExp(`^@asitis/mcp@${pkg.version.replace(/\./g, "\\.")}\\nsha256 ${sha(BUNDLE)}\\n$`));
  });
  test("the vendored server is byte-identical to the fresh build (run npm run sync-plugin after changes)", () => {
    expect(sha(path.join(PLUGIN, "server/asitis-mcp.mjs"))).toBe(sha(BUNDLE));
  });
  test("the MCP server is pinned: the vendored bundle under Node's permission model, never npx or @latest", () => {
    const s = mcp.mcpServers.asitis;
    expect(s.command).toBe("node");
    expect(s.args).toContain("--permission");
    expect(s.args).toContain("${CLAUDE_PLUGIN_ROOT}/server/asitis-mcp.mjs");
    expect(JSON.stringify(mcp)).not.toMatch(/npx|@latest|allow-fs-write|allow-net|allow-child/);
  });
  test("marketplace and manifest names match", () => {
    expect(market.plugins[0].name).toBe(manifest.name);
    expect(market.plugins[0].source).toBe("./" + path.relative(REPO, PLUGIN).split(path.sep).join("/"));
  });
  test("hook covers Write, Edit and MultiEdit in exec form", () => {
    const h = hooks.hooks.PreToolUse[0];
    expect(h.matcher).toBe("Write|Edit|MultiEdit");
    expect(h.hooks[0]).toMatchObject({ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"] });
    expect(hooks.description).toMatch(/Not a security boundary/);
  });
  test("the plugin's own skill and commands pass lint_steering with no errors or warnings", async () => {
    const c = await connect([PLUGIN]);
    for (const p of ["skills/markdown-byte-clean/SKILL.md", "commands/md-lint.md", "commands/md-budget.md"]) {
      const r = await c.call("lint_steering", { path: p });
      const issues = (r.structured["files"] as Array<{ issues: Array<{ severity: string; rule: string }> }>)[0]!.issues;
      expect(issues.filter((i) => i.severity !== "info"), p).toEqual([]);
    }
    const skill = read(path.join(PLUGIN, "skills/markdown-byte-clean/SKILL.md"));
    expect(skill.split("\n").length).toBeLessThan(500);
    await c.close();
  });
  test("claude plugin validate passes when the CLI is installed", () => {
    const which = spawnSync("claude", ["--version"], { encoding: "utf8", shell: SHELL });
    if (which.status !== 0) return; // CLI not available in this environment
    for (const target of [REPO, PLUGIN]) {
      const r = spawnSync("claude", ["plugin", "validate", target, "--strict"], { encoding: "utf8", timeout: 60_000, shell: SHELL });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toMatch(/Validation passed/);
    }
  });
});

// Built from parts so this file does not match itself.
const ATTRIBUTION = new RegExp(["Co-" + "Authored-By", "Generated " + "with", "generated " + "by (claude|ai|chatgpt)"].join("|"), "i");

describe("copy rules: no em-dashes, no emoji, no AI attribution in anything we author", () => {
  // Everything in the repository except dependencies, build output, the vendored
  // bundle with its third-party notices, the lockfile, and the byte-level fixtures
  // (which contain emoji and odd bytes on purpose).
  const SKIP = new Set(["node_modules", ".git", "dist", "test-fixtures", "package-lock.json", "asitis-mcp.mjs", "THIRD_PARTY_NOTICES.md"]);
  const authored = files(REPO, (p) => SKIP.has(path.basename(p))).filter((p) => statSync(p).isFile());
  test.each(authored.map((p) => path.relative(REPO, p)))("%s", (rel) => {
    const text = read(path.resolve(REPO, rel));
    expect(text, "em-dash").not.toContain(String.fromCharCode(0x2014));
    expect(text, "emoji").not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text, "attribution").not.toMatch(ATTRIBUTION);
  });
});
