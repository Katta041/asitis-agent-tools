// Supply-chain and packaging guarantees, plugin consistency, and copy rules.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { VERSION } from "../src/version.js";
import { BUNDLE, connect, MARKETPLACE, PKG, PLUGIN, REPO } from "./helpers.js";

// npm and claude are .cmd shims on Windows, which spawnSync only runs through a shell.
const SHELL = process.platform === "win32";

const pkg = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
const read = (p: string): string => readFileSync(p, "utf8");
const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
const CLI_BUNDLE = path.join(PKG, "dist/asitis.mjs");

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

/**
 * The files git tracks under `dir` (staged files included), so local build artifacts
 * (a stray `npm pack` .tgz, dist output) are never scanned as authored copy. Outside a
 * git checkout it falls back to walking the tree, still skipping .tgz files.
 */
function authoredFiles(dir: string, skip: (p: string) => boolean): string[] {
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--", "."], { cwd: dir, encoding: "utf8" });
  const listed = r.status === 0 ? r.stdout.split("\0").filter(Boolean).map((f) => path.join(dir, f)) : null;
  const all = listed && listed.length > 0 ? listed : files(dir, (p) => skip(p) || p.endsWith(".tgz"));
  return all.filter((p) => !skip(p) && !p.endsWith(".tgz") && existsSync(p) && statSync(p).isFile());
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
    expect(pkg.devDependencies["@modelcontextprotocol/sdk"]).toBe("1.32.2");
  });
  test("version constant matches package.json", () => expect(VERSION).toBe(pkg.version));
  test("npm links: the site home, the repo folder of each package, and the issue tracker", () => {
    const alias = JSON.parse(read(path.join(PKG, "../asitis/package.json")));
    for (const [p, dir] of [[pkg, "packages/mcp"], [alias, "packages/asitis"]] as const) {
      expect(p.homepage).toBe("https://asitis.app");
      expect(p.repository).toEqual({ type: "git", url: "git+https://github.com/Katta041/asitis-agent-tools.git", directory: dir });
      expect(typeof p.bugs === "string" ? p.bugs : p.bugs.url).toBe("https://github.com/Katta041/asitis-agent-tools/issues");
    }
  });
  test("MCP Registry metadata: server.json matches package.json (validated with mcp-publisher validate)", () => {
    const server = JSON.parse(read(path.join(PKG, "server.json")));
    // GitHub auth grants io.github.<login>/*, matched case-sensitively, and the login is Katta041.
    expect(pkg.mcpName).toBe("io.github.Katta041/asitis-mcp");
    expect(server.name).toBe(pkg.mcpName);
    expect(server.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toHaveLength(1);
    const p = server.packages[0];
    expect(p).toMatchObject({ registryType: "npm", identifier: pkg.name, version: pkg.version, transport: { type: "stdio" } });
    expect(p.packageArguments.map((a: { name: string }) => a.name)).toEqual(["--root"]);
  });
  test("bins: the MCP server, the asitis CLI, and mcp so plain npx @asitis/mcp starts the server", () => {
    // npx with no bin named runs the bin called after the unscoped package name ("mcp"). Without it,
    // `npx -y @asitis/mcp` failed with "could not determine executable to run" from 0.3.0 to 0.4.1.
    expect(pkg.bin).toEqual({ "asitis-mcp": "dist/asitis-mcp.mjs", asitis: "dist/asitis.mjs", mcp: "dist/asitis-mcp.mjs" });
    expect(pkg.name.split("/").pop()).toBe("mcp");
  });
  test("every npx line in the docs uses a form npx can resolve", () => {
    const docs = ["README.md", "packages/mcp/README.md", "docs/ci.md", "docs/cli-contract.md", "action/README.md"];
    let seen = 0;
    for (const f of docs) {
      for (const line of read(path.join(REPO, f)).split("\n")) {
        for (const m of line.matchAll(/npx (?:--prefix=~\/ )?-y (-p )?@asitis\/mcp@(\S+) ?(\S*)/g)) {
          seen++;
          expect(m[2], `${f}: ${line}`).toBe(pkg.version);
          // With -p the next word must name a bin; without it npx runs the "mcp" bin.
          if (m[1]) expect(Object.keys(pkg.bin), `${f}: ${line}`).toContain(m[3]);
        }
        // The asitis alias package (packages/asitis) runs the CLI: npx -y asitis@<version> lint.
        for (const m of line.matchAll(/npx (?:--prefix=~\/ )?-y asitis@(\S+)/g)) {
          seen++;
          expect(m[1], `${f}: ${line}`).toBe(pkg.version);
        }
        for (const m of line.matchAll(/"-y", "(-p", ")?@asitis\/mcp@([^"]+)"/g)) {
          seen++;
          expect(m[2], `${f}: ${line}`).toBe(pkg.version);
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
  });
  test("every MCP server config in the docs runs npx with --prefix=~/, so a repo's own node_modules is never used", () => {
    // npx runs node_modules/@asitis/mcp from the folder it starts in when the version matches, and
    // MCP clients often start servers in the project. --prefix=~/ moves that lookup to the home folder.
    const docs = ["README.md", "packages/mcp/README.md", "docs/install.md"];
    let seen = 0;
    for (const f of docs) {
      const text = read(path.join(REPO, f));
      for (const m of text.matchAll(/(.{0,20})"-y", ?"@asitis\/mcp@/g)) {
        seen++;
        expect(m[1], f).toMatch(/"--prefix=~\/", ?$/);
      }
      expect(text, f).not.toMatch(/npx -y @asitis\/mcp@\S+ --root/);
      for (const l of text.matchAll(/vscode\.dev\/redirect\?url=([^)\s"]+)/g)) {
        const cfg = JSON.parse(decodeURIComponent(decodeURIComponent(l[1]!).split("?")[1]!));
        expect(cfg.args.slice(0, 2), f).toEqual(["--prefix=~/", "-y"]);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
  test("provenance on, public access", () => expect(pkg.publishConfig).toEqual({ access: "public", provenance: true }));
  test("the published tarball contains only the bundle, notices and docs", () => {
    const r = npm(["pack", "--dry-run", "--json", "--ignore-scripts"], PKG);
    expect(r.error, "npm could not be started").toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    const listed = (JSON.parse(r.stdout)[0].files as Array<{ path: string }>).map((f) => f.path).sort();
    expect(listed).toEqual(["CHANGELOG.md", "LICENSE", "README.md", "dist/THIRD_PARTY_NOTICES.md", "dist/asitis-mcp.mjs", "dist/asitis.mjs", "package.json"]);
  });
});

// packages/asitis is the unscoped `asitis` package, so `npx asitis lint` works. It holds no code
// of its own: one file that imports the CLI bundle from @asitis/mcp at the same exact version.
describe("asitis alias package", () => {
  const ALIAS = path.join(REPO, "packages/asitis");
  const alias = JSON.parse(read(path.join(ALIAS, "package.json")));

  test("same version, pinned to exactly this @asitis/mcp, no install scripts", () => {
    expect(alias.name).toBe("asitis");
    expect(alias.version).toBe(pkg.version);
    expect(alias.dependencies).toEqual({ "@asitis/mcp": pkg.version });
    expect(alias.scripts ?? {}).toEqual({});
    expect(alias.bin).toEqual({ asitis: "cli.mjs" });
    expect(alias.files).toEqual(["cli.mjs", "README.md", "LICENSE"]);
    expect(alias.engines).toEqual(pkg.engines);
  });
  test("its README pins this version", () => {
    const pins = [...read(path.join(ALIAS, "README.md")).matchAll(/\basitis@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.filter((v) => v !== pkg.version)).toEqual([]);
  });
  test("runs the CLI and passes arguments through", () => {
    const r = spawnSync(process.execPath, [path.join(ALIAS, "cli.mjs"), "--version"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });
});

describe("no write, exec or network code", () => {
  const FORBIDDEN_SRC = [
    /child_process/, /node:net\b/, /node:http/, /node:https/, /node:dns/, /node:tls/, /node:dgram/, /worker_threads/, /\bfetch\s*\(/,
    /\b(writeFile|appendFile|mkdir|mkdtemp|rm|rmdir|unlink|rename|copyFile|cp|symlink|link|chmod|chown|lchown|utimes|lutimes|truncate|ftruncate)(Sync)?\s*\((?!s\))/,
    /createWriteStream/, /O_WRONLY|O_RDWR|O_CREAT|O_APPEND/, /\beval\s*\(/, /\bFunction\s*\(/,
  ];
  // Every source file, subfolders included (rules/, checks/, policy/, format/, fixes/, cli/).
  const sources = files(path.join(PKG, "src")).map((p) => path.relative(path.join(PKG, "src"), p).split(path.sep).join("/"));
  test("the scan sees the subfolders", () => {
    expect(sources).toContain("rules/registry.ts");
    expect(sources).toContain("checks/index.ts");
  });
  test.each(sources)("src/%s", (f) => {
    const src = read(path.join(PKG, "src", f));
    for (const re of FORBIDDEN_SRC) expect(src, `${f} matches ${re}`).not.toMatch(re);
  });
  test("the bundle imports no network or process modules", () => {
    const b = read(BUNDLE);
    for (const m of ["child_process", "net", "http", "https", "http2", "dns", "tls", "dgram", "worker_threads", "cluster"]) {
      expect(b, m).not.toMatch(new RegExp(`(from\\s*["']|require\\(["'])(node:)?${m}["']`));
    }
  });
  test("the CLI bundle imports only the Node modules the server uses, and nothing that writes", () => {
    const b = read(CLI_BUNDLE);
    expect(b.startsWith("#!/usr/bin/env node\n")).toBe(true);
    // (?<![\w-]): the agent-config check has the string "--from" (npx flags), which minifies to --from","
    const mods = new Set([...b.matchAll(/(?<![\w-])(?:from\s*["']|require\(["']|import\(["'])([^"']+)["']/g)].map((m) => m[1]!));
    const allowed = new Set(["node:fs", "node:path", "node:crypto", "node:os", "node:util", "node:process", "node:module"]);
    for (const m of mods) expect(allowed.has(m), m).toBe(true);
    for (const m of ["child_process", "net", "http", "https", "http2", "dns", "tls", "dgram", "worker_threads", "cluster"]) {
      expect(b, m).not.toMatch(new RegExp(`(from\\s*["']|require\\(["'])(node:)?${m}["']`));
    }
    for (const re of [/\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|symlink|chmod|chown|truncate)(Sync)?\s*\(/, /createWriteStream/, /\bfetch\s*\(/, /\beval\s*\(/]) {
      expect(b, String(re)).not.toMatch(re);
    }
    // No MCP SDK or zod in the CLI: it only lints.
    expect(b).not.toMatch(/modelcontextprotocol|jsonrpc/);
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
    expect(read(path.join(PLUGIN, "server/VERSION"))).toBe(`@asitis/mcp@${pkg.version}\nsha256 ${sha(BUNDLE)}\nasitis.mjs sha256 ${sha(CLI_BUNDLE)}\n`);
    expect(read(path.join(REPO, "action/VERSION"))).toBe(`@asitis/mcp@${pkg.version}\nasitis.mjs sha256 ${sha(CLI_BUNDLE)}\n`);
  });
  test("the vendored server is byte-identical to the fresh build (run npm run sync-plugin after changes)", () => {
    expect(sha(path.join(PLUGIN, "server/asitis-mcp.mjs"))).toBe(sha(BUNDLE));
  });
  test("both copies of the CLI are byte-identical to the fresh build (run npm run sync-plugin after changes)", () => {
    expect(sha(path.join(PLUGIN, "server/asitis.mjs"))).toBe(sha(CLI_BUNDLE));
    expect(sha(path.join(REPO, "action/asitis.mjs"))).toBe(sha(CLI_BUNDLE));
  });
  test("CI checks all three SHA-256 pins", () => {
    const ci = read(path.join(REPO, ".github/workflows/ci.yml"));
    for (const f of ["plugins/asitis/server/asitis-mcp.mjs", "plugins/asitis/server/asitis.mjs", "action/asitis.mjs"]) expect(ci).toContain(f);
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
    for (const p of ["skills/markdown-byte-clean/SKILL.md", "skills/steering-check/SKILL.md", "commands/md-lint.md", "commands/md-budget.md", "commands/md-fix.md"]) {
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

describe("Codex plugin and Gemini CLI extension", () => {
  const codex = JSON.parse(read(path.join(PLUGIN, ".codex-plugin/plugin.json")));
  const codexMcp = JSON.parse(read(path.join(PLUGIN, "codex.mcp.json")));
  const gemini = JSON.parse(read(path.join(REPO, "gemini-extension.json")));

  test("versions agree with the package", () => {
    expect(codex.version).toBe(pkg.version);
    expect(gemini.version).toBe(pkg.version);
    expect(codex.name).toBe("asitis");
    expect(gemini.name).toBe("asitis");
  });
  // Codex expands no variables in plugin MCP args (codex-rs/codex-mcp/src/plugin_config.rs only
  // resolves a relative cwd against the plugin root), so the plugin cannot point at the bundled
  // server and the project folder at the same time. It runs the pinned npm package with no --root,
  // which makes the server read the folder Codex starts it in. --prefix=~/ makes npx look for an
  // installed copy (and an .npmrc) in the home folder instead of that project, so a repo that
  // commits node_modules/@asitis/mcp at the same version cannot run its own code.
  test("Codex runs the pinned npm package, never @latest, never the project's node_modules", () => {
    expect(codex.mcpServers).toBe("./codex.mcp.json");
    expect(codexMcp.mcpServers.asitis).toEqual({ command: "npx", args: ["--prefix=~/", "-y", `@asitis/mcp@${pkg.version}`] });
  });
  test("Gemini runs the bundled server under Node's permission model, reading only the workspace", () => {
    const s = gemini.mcpServers.asitis;
    expect(s.command).toBe("node");
    expect(s.args).toContain("--permission");
    expect(s.args).toContain("--allow-fs-read=${workspacePath}");
    expect(s.args.slice(-2)).toEqual(["--root", "${workspacePath}"]);
    expect(JSON.stringify(gemini)).not.toMatch(/npx|@latest|allow-fs-write|allow-net|allow-child/);
    expect(existsSync(path.join(REPO, gemini.contextFileName))).toBe(true);
  });
  test("each Gemini command mirrors a Claude Code command", () => {
    for (const name of ["md-lint", "md-loads", "md-budget", "md-fix"]) {
      expect(existsSync(path.join(REPO, "commands/asitis", `${name}.toml`)), name).toBe(true);
      expect(existsSync(path.join(PLUGIN, "commands", `${name}.md`)), name).toBe(true);
    }
  });
});

describe("Dockerfile", () => {
  test("labels the image with this version and copies only the prebuilt server", () => {
    const d = read(path.join(REPO, "Dockerfile"));
    expect(d).toContain(`org.opencontainers.image.version="${pkg.version}"`);
    expect(d).not.toMatch(/^RUN\b/m);
    expect(d).toMatch(/^USER node$/m);
  });
});

describe("Cursor plugin", () => {
  const CURSOR = path.join(REPO, "plugins/asitis-cursor");
  const manifest = JSON.parse(read(path.join(CURSOR, ".cursor-plugin/plugin.json")));
  const market = JSON.parse(read(path.join(REPO, ".cursor-plugin/marketplace.json")));
  const mcp = JSON.parse(read(path.join(CURSOR, "mcp.json")));
  const frontmatter = (p: string): Record<string, string> => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(read(p).replace(/\r\n/g, "\n"));
    expect(m, p).not.toBeNull();
    return Object.fromEntries(m![1]!.split("\n").filter((l) => l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
  };

  test("versions agree with the package", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(market.metadata.version).toBe(pkg.version);
  });
  test("the MCP server is pinned to this exact version, never @latest", () => {
    const s = mcp.mcpServers.asitis;
    expect(s.command).toBe("npx");
    // --prefix=~/ so npx never runs a node_modules/@asitis/mcp (or reads an .npmrc) committed to the opened repo.
    expect(s.args).toEqual(["--prefix=~/", "-y", `@asitis/mcp@${pkg.version}`, "--root", "${workspaceFolder}"]);
    expect(JSON.stringify(mcp)).not.toMatch(/@latest/);
  });
  test("marketplace entry points at the plugin folder and the names match", () => {
    expect(market.owner.name).toBeTruthy();
    expect(market.plugins).toHaveLength(1);
    expect(market.plugins[0].name).toBe(manifest.name);
    expect(market.plugins[0].source).toBe("./plugins/asitis-cursor");
    expect(manifest.name).toMatch(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    expect(existsSync(path.join(CURSOR, manifest.logo))).toBe(true);
  });
  test("every rule, skill and command has the frontmatter Cursor's marketplace review asks for", () => {
    for (const f of files(path.join(CURSOR, "rules"))) expect(frontmatter(f)["description"], f).toBeTruthy();
    for (const f of files(path.join(CURSOR, "skills")).filter((p) => p.endsWith("SKILL.md"))) {
      const fm = frontmatter(f);
      expect(fm["name"] && fm["description"], f).toBeTruthy();
    }
    for (const f of files(path.join(CURSOR, "commands"))) {
      const fm = frontmatter(f);
      expect(fm["name"] && fm["description"], f).toBeTruthy();
    }
  });
  test("the rule only attaches to steering files, so it costs nothing at session start", () => {
    const fm = frontmatter(path.join(CURSOR, "rules/check-steering-files.mdc"));
    expect(fm["alwaysApply"]).toBe("false");
    expect(fm["globs"]).toMatch(/AGENTS\.md/);
  });
  test("its rule, skill and commands pass lint_steering with no errors or warnings", async () => {
    const c = await connect([CURSOR]);
    for (const p of ["rules/check-steering-files.mdc", "skills/markdown-byte-clean/SKILL.md", "commands/md-lint.md", "commands/md-loads.md", "commands/md-budget.md"]) {
      const r = await c.call("lint_steering", { path: p });
      const issues = (r.structured["files"] as Array<{ issues: Array<{ severity: string; rule: string }> }>)[0]!.issues;
      expect(issues.filter((i) => i.severity !== "info"), p).toEqual([]);
    }
    await c.close();
  });
  test("Add to Cursor links carry the same pinned config as the plugin (the version is inside base64, so the pin check above can't see it)", () => {
    const links = [path.join(REPO, "README.md"), path.join(REPO, "docs/install.md")]
      .flatMap((d) => [...read(d).matchAll(/cursor\.com\/en\/install-mcp\?name=asitis&config=([^)\s"]+)/g)].map((m) => m[1]!));
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(JSON.parse(Buffer.from(decodeURIComponent(l), "base64").toString("utf8"))).toEqual(mcp.mcpServers.asitis);
  });
  test("the skill matches the Claude Code plugin's apart from the command names", () => {
    const claude = read(path.join(PLUGIN, "skills/markdown-byte-clean/SKILL.md")).replaceAll("/asitis:md-", "/md-");
    expect(read(path.join(CURSOR, "skills/markdown-byte-clean/SKILL.md"))).toBe(claude);
  });
});

// Built from parts so this file does not match itself.
const ATTRIBUTION = new RegExp(["Co-" + "Authored-By", "Generated " + "with", "generated " + "by (claude|ai|chatgpt)"].join("|"), "i");

describe("copy rules: no em-dashes, no emoji, no AI attribution in anything we author", () => {
  // Every git-tracked file in the repository except the vendored bundle with its
  // third-party notices, the lockfile, and the byte-level fixtures (which contain emoji
  // and odd bytes on purpose). Untracked build artifacts (a local .tgz, dist) are never scanned.
  const SKIP = new Set(["node_modules", ".git", "dist", "test-fixtures", "package-lock.json", "asitis-mcp.mjs", "asitis.mjs", "THIRD_PARTY_NOTICES.md"]);
  // Binary media (the README demo GIF) is not text, so it is not scanned either.
  const BINARY = /\.(gif|png|jpe?g|webp|webm|mp4)$/i;
  const authored = authoredFiles(REPO, (p) => BINARY.test(p) || path.relative(REPO, p).split(path.sep).some((s) => SKIP.has(s)));
  test("build artifacts are not scanned: only git-tracked files, never a local .tgz or dist output", () => {
    expect(authored.length).toBeGreaterThan(10);
    expect(authored.some((p) => p.endsWith(".tgz"))).toBe(false);
    expect(authored.some((p) => p.includes(path.join(PKG, "dist")))).toBe(false);
    expect(authored).toContain(path.join(PLUGIN, "hooks", "guard.mjs"));
  });
  test.each(authored.map((p) => path.relative(REPO, p)))("%s", (rel) => {
    const text = read(path.resolve(REPO, rel));
    expect(text, "em-dash").not.toContain(String.fromCharCode(0x2014));
    expect(text, "emoji").not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text, "attribution").not.toMatch(ATTRIBUTION);
  });
});

describe("docs never pin a stale version", () => {
  // Install snippets pin an exact version on purpose (never @latest in an agent config), so every
  // pin must move with the release. This fails the release, not a reader, when one is missed.
  const docs = [path.join(REPO, "README.md"), path.join(PKG, "README.md"), path.join(REPO, "docs/install.md")].filter((p) => existsSync(p));
  for (const doc of docs) {
    test(`${path.relative(REPO, doc)} pins @asitis/mcp at ${pkg.version}`, () => {
      const pins = [...read(doc).matchAll(/@asitis\/mcp@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
      expect(pins.length).toBeGreaterThan(0);
      expect(pins.filter((v) => v !== pkg.version)).toEqual([]);
    });
  }
});
