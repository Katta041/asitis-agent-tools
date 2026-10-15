// Bundles the MCP server (dist/asitis-mcp.mjs) and the asitis CLI (dist/asitis.mjs) into one file
// each, with zero runtime dependencies, and writes third-party license notices for everything inlined.
// Usage: node scripts/build.mjs [--sync-plugin]
//   --sync-plugin also copies both bundles into plugins/asitis/server/ and the CLI into action/,
//   and records each SHA-256 in the VERSION file next to it.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const repoRoot = path.resolve(pkgDir, "../..");
const dist = path.join(pkgDir, "dist");
const outfile = path.join(dist, "asitis-mcp.mjs");
const cliOutfile = path.join(dist, "asitis.mjs");
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));

mkdirSync(dist, { recursive: true });
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  keepNames: false,
  sourcemap: false,
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
};
// CommonJS dependencies inside the bundle may call require() for Node built-ins.
const requireShim = ['import { createRequire as __asitisCreateRequire } from "node:module";', "const require = __asitisCreateRequire(import.meta.url);"];
const result = await build({
  ...common,
  entryPoints: [path.join(pkgDir, "src/cli.ts")],
  outfile,
  banner: { js: ["#!/usr/bin/env node", `// @asitis/mcp ${pkg.version}. Read-only MCP server. Third-party notices: THIRD_PARTY_NOTICES.md`, ...requireShim].join("\n") },
});
// The CLI: src/cli/asitis.ts exports main(); this two-line entry runs it.
const cliResult = await build({
  ...common,
  stdin: { contents: 'import { main } from "./src/cli/asitis.ts";\nawait main();\n', resolveDir: pkgDir, sourcefile: "asitis-bin.ts", loader: "ts" },
  outfile: cliOutfile,
  banner: { js: ["#!/usr/bin/env node", `// @asitis/mcp ${pkg.version}. asitis CLI, read-only. Third-party notices: THIRD_PARTY_NOTICES.md`, ...requireShim].join("\n") },
});
chmodSync(cliOutfile, 0o755);
chmodSync(outfile, 0o755);

// Third-party notices from the packages that ended up in the bundle.
const packages = new Map();
for (const input of [...Object.keys(result.metafile.inputs), ...Object.keys(cliResult.metafile.inputs)]) {
  const m = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input.split(path.sep).join("/"));
  if (!m) continue;
  const name = m[2];
  if (packages.has(name)) continue;
  const dir = path.resolve(process.cwd(), m[1]);
  const pj = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const licFile = readdirSync(dir).find((f) => /^(licen[sc]e|copying)/i.test(f));
  packages.set(name, { version: pj.version, license: pj.license ?? "UNKNOWN", text: licFile ? readFileSync(path.join(dir, licFile), "utf8").trim() : "(no license file shipped)" });
}
const notices = [
  "# Third-party notices",
  "",
  `@asitis/mcp ${pkg.version} bundles the following packages.`,
  "",
  ...[...packages.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, p]) => [`## ${name} ${p.version} (${p.license})`, "", "```", p.text, "```", ""]),
].join("\n");
writeFileSync(path.join(dist, "THIRD_PARTY_NOTICES.md"), notices);

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const serverSha = sha(outfile);
const cliSha = sha(cliOutfile);
console.log(`Built ${path.relative(repoRoot, outfile)}: ${readFileSync(outfile).length} bytes, sha256 ${serverSha}, ${packages.size} bundled packages (${[...packages.keys()].join(", ")})`);
console.log(`Built ${path.relative(repoRoot, cliOutfile)}: ${readFileSync(cliOutfile).length} bytes, sha256 ${cliSha}`);

if (process.argv.includes("--sync-plugin")) {
  const serverDir = path.join(repoRoot, "plugins/asitis/server");
  if (!existsSync(path.dirname(serverDir))) {
    console.error("build: plugins/asitis not found next to packages/mcp. Run this from a full checkout of the repository.");
    process.exit(1);
  }
  mkdirSync(serverDir, { recursive: true });
  copyFileSync(outfile, path.join(serverDir, "asitis-mcp.mjs"));
  copyFileSync(cliOutfile, path.join(serverDir, "asitis.mjs"));
  copyFileSync(path.join(dist, "THIRD_PARTY_NOTICES.md"), path.join(serverDir, "THIRD_PARTY_NOTICES.md"));
  // Line 2 stays "sha256 <server>" so older pin checks keep working; the CLI pin is line 3.
  writeFileSync(path.join(serverDir, "VERSION"), `@asitis/mcp@${pkg.version}\nsha256 ${serverSha}\nasitis.mjs sha256 ${cliSha}\n`);
  console.log(`Synced bundles into ${path.relative(repoRoot, serverDir)}`);
  // The GitHub Action (WP3) runs the CLI from action/asitis.mjs.
  const actionDir = path.join(repoRoot, "action");
  mkdirSync(actionDir, { recursive: true });
  copyFileSync(cliOutfile, path.join(actionDir, "asitis.mjs"));
  writeFileSync(path.join(actionDir, "VERSION"), `@asitis/mcp@${pkg.version}\nasitis.mjs sha256 ${cliSha}\n`);
  console.log(`Synced CLI into ${path.relative(repoRoot, actionDir)}`);
}
