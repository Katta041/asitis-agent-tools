// Bundles the server into one file with zero runtime dependencies, and writes
// third-party license notices for everything inlined.
// Usage: node scripts/build.mjs [--sync-plugin]
//   --sync-plugin also copies the bundle into plugins/asitis/server/ and records its SHA-256.
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
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));

mkdirSync(dist, { recursive: true });
const result = await build({
  entryPoints: [path.join(pkgDir, "src/cli.ts")],
  outfile,
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
  // CommonJS dependencies inside the bundle may call require() for Node built-ins.
  banner: {
    js: [
      "#!/usr/bin/env node",
      `// @asitis/mcp ${pkg.version}. Read-only MCP server. Third-party notices: THIRD_PARTY_NOTICES.md`,
      'import { createRequire as __asitisCreateRequire } from "node:module";',
      "const require = __asitisCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
chmodSync(outfile, 0o755);

// Third-party notices from the packages that ended up in the bundle.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
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

const bytes = readFileSync(outfile);
const sha = createHash("sha256").update(bytes).digest("hex");
console.log(`Built ${path.relative(repoRoot, outfile)}: ${bytes.length} bytes, sha256 ${sha}, ${packages.size} bundled packages (${[...packages.keys()].join(", ")})`);

if (process.argv.includes("--sync-plugin")) {
  const serverDir = path.join(repoRoot, "plugins/asitis/server");
  if (!existsSync(path.dirname(serverDir))) {
    console.error("build: plugins/asitis not found next to packages/mcp. Run this from a full checkout of the repository.");
    process.exit(1);
  }
  mkdirSync(serverDir, { recursive: true });
  copyFileSync(outfile, path.join(serverDir, "asitis-mcp.mjs"));
  copyFileSync(path.join(dist, "THIRD_PARTY_NOTICES.md"), path.join(serverDir, "THIRD_PARTY_NOTICES.md"));
  writeFileSync(path.join(serverDir, "VERSION"), `@asitis/mcp@${pkg.version}\nsha256 ${sha}\n`);
  console.log(`Synced bundle into ${path.relative(repoRoot, serverDir)}`);
}
