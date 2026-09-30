import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sandbox, type SandboxOptions } from "../src/paths.js";
import { createServer, FOOTER } from "../src/server.js";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG = path.resolve(HERE, "..");
export const REPO = path.resolve(PKG, "../..");
export const FIXTURES = path.join(REPO, "test-fixtures");
export const AGENTIC = path.join(FIXTURES, "agentic");
export const FIXTURE_REPO = path.join(AGENTIC, "repo");
export const BUNDLE = path.join(PKG, "dist/asitis-mcp.mjs");
export const PLUGIN = path.join(REPO, "plugins/asitis");
export const MARKETPLACE = path.join(REPO, ".claude-plugin/marketplace.json");
export { FOOTER };

export interface CallResult {
  text: string;
  blocks: string[];
  structured: Record<string, unknown>;
  isError: boolean;
  ms: number;
}

export interface Connected {
  client: Client;
  call: (name: string, args?: Record<string, unknown>) => Promise<CallResult>;
  close: () => Promise<void>;
}

export async function toResult(client: Client, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const t0 = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const ms = performance.now() - t0;
  const blocks = (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "");
  return { text: blocks.join("\n"), blocks, structured: (r.structuredContent ?? {}) as Record<string, unknown>, isError: !!r.isError, ms };
}

/** Connects an SDK client to an in-process server over the SDK's in-memory transport. */
export async function connect(roots: string[], opts: { footer?: boolean } & SandboxOptions = {}): Promise<Connected> {
  const sandbox = await Sandbox.create(roots, opts);
  const server = createServer(sandbox, { footer: opts.footer ?? true });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "asitis-test", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    client,
    call: (name, args = {}) => toResult(client, name, args),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function tempDir(prefix = "asitis-mcp-"): { dir: string; cleanup: () => void } {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
