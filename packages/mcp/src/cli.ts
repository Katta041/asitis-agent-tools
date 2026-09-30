// Entry point: parses arguments, confines to the root folder(s), serves over stdio.
// Logs go to stderr only and never include file content.

import path from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Sandbox, UserError } from "./paths.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `asitis-mcp ${VERSION}: read-only MCP server for markdown and agent steering files.

Usage: asitis-mcp --root <folder> [--root <folder>...] [options]

  --root <folder>      Folder the server may read (repeatable). Default: the current folder.
  --no-footer          Do not end tool results with the asitis.app line.
  --max-file-mb <n>    Largest file to analyse, in MB (default 16, max 64).
  --allow-broad-root   Allow your home folder or the filesystem root as the root.
  --version            Print the version.
  --help               Print this help.

Environment: ASITIS_MCP_ROOT (folders separated by "${path.delimiter}"), ASITIS_MCP_FOOTER=0 to hide the footer.
Tools: read_markdown, outline, lint_steering, context_budget, find_steering_files. No writes, no network.`;

function fail(message: string): never {
  process.stderr.write(`asitis-mcp: ${message}\n`);
  process.exit(2);
}

const off = (v: string | undefined): boolean => v !== undefined && ["0", "false", "off", "no"].includes(v.trim().toLowerCase());

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        root: { type: "string", multiple: true },
        "no-footer": { type: "boolean" },
        footer: { type: "string" },
        "max-file-mb": { type: "string" },
        "allow-broad-root": { type: "boolean" },
        version: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    // Node appends a long hint about positionals to unknown-option errors; keep the first sentence.
    const first = ((e as Error).message.split("\n")[0] ?? "").split(". To specify")[0]!.replace(/\.$/, "");
    fail(`${first}. Run asitis-mcp --help for usage.`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (values.version) {
    process.stdout.write(VERSION + "\n");
    return;
  }
  const roots = [...(values.root ?? []), ...positionals];
  if (!roots.length && process.env["ASITIS_MCP_ROOT"]) roots.push(...process.env["ASITIS_MCP_ROOT"].split(path.delimiter).filter(Boolean));
  if (!roots.length) roots.push(process.cwd());
  // An unexpanded placeholder means the host did not substitute its variable.
  for (const r of roots) if (/\$\{[^}]*\}/.test(r)) fail(`root "${r}" contains an unexpanded variable; pass a real folder with --root.`);

  let maxFileBytes: number | undefined;
  if (values["max-file-mb"] !== undefined) {
    const mb = Number(values["max-file-mb"]);
    if (!Number.isFinite(mb) || mb <= 0 || mb > 64) fail("--max-file-mb must be a number between 1 and 64.");
    maxFileBytes = Math.floor(mb * 1024 * 1024);
  }
  const footer = !(values["no-footer"] || off(values.footer) || off(process.env["ASITIS_MCP_FOOTER"]));

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(roots, { allowBroadRoot: !!values["allow-broad-root"], ...(maxFileBytes ? { maxFileBytes } : {}) });
  } catch (e) {
    fail(e instanceof UserError ? e.message : `could not start: ${(e as Error).message}`);
  }

  if (process.stdin.isTTY) {
    process.stderr.write("asitis-mcp speaks MCP (JSON-RPC) on stdin and stdout. Add it to your MCP client instead of running it by hand; see --help.\n");
  }
  const server = createServer(sandbox, { footer });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`asitis-mcp ${VERSION} ready: read-only, ${sandbox.roots.length} root folder(s): ${sandbox.roots.map((r) => r.real).join(", ")}\n`);
}

process.on("uncaughtException", (e) => {
  process.stderr.write(`asitis-mcp: unexpected error: ${e.message}\n`);
  process.exit(1);
});

main().catch((e: unknown) => fail(`could not start: ${(e as Error).message}`));
