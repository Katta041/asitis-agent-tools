// STUB BUILD FOR THE WP3 BRANCH ONLY. DELETE THIS FOLDER WHEN WP1 MERGES.
// Bundles action/stub/asitis-stub.ts into action/asitis.mjs with the server bundle's settings, so
// the Action and pre-commit hook have a CLI to run before WP1's real one lands.
// Usage, from the repo root after npm ci: node action/stub/build-stub.mjs
import { build } from "esbuild";
import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const outfile = path.join(repo, "action/asitis.mjs");
const pkg = JSON.parse(readFileSync(path.join(repo, "packages/mcp/package.json"), "utf8"));

await build({
  entryPoints: [path.join(here, "asitis-stub.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  banner: {
    js: [
      "#!/usr/bin/env node",
      `// STUB asitis CLI (WP3 branch only, built from action/stub/). Replace with WP1's bundle via npm run sync-plugin. @asitis/mcp ${pkg.version}`,
      'import { createRequire as __asitisCreateRequire } from "node:module";',
      "const require = __asitisCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
chmodSync(outfile, 0o755);
console.log(`Built ${path.relative(repo, outfile)} (stub)`);
