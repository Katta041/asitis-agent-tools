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
  (with npx: npx -y @asitis/mcp@${VERSION} --root <folder>)

  --root <folder>      Folder the server may read (repeatable). Default: the current folder.
  --footer             Add one line linking to asitis.app to the first result of the session. Off by default.
  --structured         Also return each result as JSON (structuredContent), for scripts. Off by default,
                       because some clients then show the model only the JSON.
  --max-file-mb <n>    Largest file to analyse, in MB (default 16, max 64).
  --allow-broad-root   Allow your home folder or the filesystem root as the root.
  --version            Print the version.
  --help               Print this help.

Environment: ASITIS_MCP_ROOT (folders separated by "${path.delimiter}"), ASITIS_MCP_FOOTER=1 to add that line,
ASITIS_MCP_STRUCTURED=1 for --structured.
Tools: read_markdown, outline, lint_steering, context_budget, find_steering_files, suggest_fixes. No writes, no network.
Docs: https://github.com/Katta041/asitis-agent-tools/tree/main/packages/mcp`;

function fail(message: string): never {
  process.stderr.write(`asitis-mcp: ${message}\n`);
  process.exit(2);
}

const off = (v: string | undefined): boolean => v !== undefined && ["0", "false", "off", "no"].includes(v.trim().toLowerCase());
const on = (v: string | undefined): boolean => v !== undefined && ["1", "true", "on", "yes"].includes(v.trim().toLowerCase());

/** `--footer` alone turns the footer on; `--footer false` and `--footer=0` still parse as before 0.2.5. */
function normaliseFooterFlag(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a !== "--footer") { out.push(a); continue; }
    const next = argv[i + 1];
    if (next !== undefined && (on(next) || off(next))) {
      out.push(`--footer=${next}`);
      i++;
    } else out.push("--footer=1");
  }
  return out;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: normaliseFooterFlag(argv),
      allowPositionals: true,
      options: {
        root: { type: "string", multiple: true },
        "no-footer": { type: "boolean" },
        footer: { type: "string" },
        structured: { type: "boolean" },
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
  // The asitis.app line is opt-in: --footer or ASITIS_MCP_FOOTER=1. --no-footer is still accepted (it is the default).
  const footer = !values["no-footer"] && (values.footer !== undefined ? on(values.footer) : on(process.env["ASITIS_MCP_FOOTER"]));

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(roots, { allowBroadRoot: !!values["allow-broad-root"], ...(maxFileBytes ? { maxFileBytes } : {}) });
  } catch (e) {
    fail(e instanceof UserError ? e.message : `could not start: ${(e as Error).message}`);
  }

  if (process.stdin.isTTY) {
    process.stderr.write("asitis-mcp speaks MCP (JSON-RPC) on stdin and stdout. Add it to your MCP client instead of running it by hand; see --help.\n");
  }
  const structured = !!values.structured || on(process.env["ASITIS_MCP_STRUCTURED"]);
  const server = createServer(sandbox, { footer, structured });
  const transport = new StdioServerTransport();
  // Messages the SDK cannot parse get no response from it. Answer them as JSON-RPC says
  // (-32700 for bad JSON, -32600 for a message that is not a JSON-RPC request), with id null.
  // A message over the SDK's 10 MB read buffer closes the connection: say why and exit non-zero.
  transport.onerror = (err: Error) => {
    const reply = (code: number, message: string): void => {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }) + "\n");
    };
    if (err instanceof SyntaxError) reply(-32700, "Parse error: the message is not valid JSON.");
    else if (Array.isArray((err as { issues?: unknown }).issues)) reply(-32600, "Invalid Request: the message is not a JSON-RPC 2.0 request, notification or response (batches are not supported).");
    else if (/ReadBuffer exceeded/.test(err.message)) {
      process.stderr.write("asitis-mcp: received a message larger than 10 MB; closing the connection.\n");
      process.exitCode = 1;
    }
  };
  await server.connect(transport);
  process.stderr.write(`asitis-mcp ${VERSION} ready: read-only, ${sandbox.roots.length} root folder(s): ${sandbox.roots.map((r) => r.real).join(", ")}\n`);
}

process.on("uncaughtException", (e) => {
  process.stderr.write(`asitis-mcp: unexpected error: ${e.message}\n`);
  process.exit(1);
});

main().catch((e: unknown) => fail(`could not start: ${(e as Error).message}`));
