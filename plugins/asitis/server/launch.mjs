#!/usr/bin/env node
// AsItIs MCP server launcher for the Claude Code plugin.
//
// .mcp.json runs this file with plain `node` (no flags) and passes the exact Node
// flags the server should run with. The launcher does three things, then starts
// the server as a child process and gets out of the way:
//
// 1. Checks the Node version first. Node older than 22.13 rejects --permission
//    with a bare "bad option" line that names neither AsItIs nor the fix, so the
//    launcher prints one actionable line instead.
// 2. Drops any --allow-fs-read folder that sits inside another allowed folder.
//    Node's permission model denies reading the outer folder itself (stat,
//    readdir) when a folder nested inside it is also allowed, which stopped the
//    server from starting when the plugin folder was inside the project, or when
//    a session ran in the home folder. The read grant is unchanged: the outer
//    folder already covers the nested one.
// 3. Starts the bundled server (and only that file) under --permission, with
//    stdin, stdout and stderr passed straight through, and exits with its code.
//
// It reads no files and makes no network calls. Dependency-free, and written
// for old Node versions too, so that the version message itself always runs.

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIN = [22, 13, 0];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "asitis-mcp.mjs");

function fail(message, code) {
  process.stderr.write(`asitis-mcp: ${message}\n`);
  process.exit(code);
}

export function nodeTooOld(version) {
  const v = String(version).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((v[i] || 0) > MIN[i]) return false;
    if ((v[i] || 0) < MIN[i]) return true;
  }
  return false;
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

function inside(outer, inner) {
  const rel = path.relative(outer, inner);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

/** Removes --allow-fs-read folders already covered by another allowed folder (and exact repeats). */
export function dedupeReadGrants(args) {
  const PREFIX = "--allow-fs-read=";
  const grants = [];
  args.forEach((a, index) => {
    if (a.startsWith(PREFIX)) grants.push({ index, real: real(a.slice(PREFIX.length)) });
  });
  const drop = new Set();
  for (const g of grants) {
    for (const h of grants) {
      if (g === h || drop.has(h.index)) continue;
      // g is covered by h: drop g. Of two equal paths, keep the first one.
      if (inside(h.real, g.real) && (h.real !== g.real || h.index < g.index)) {
        drop.add(g.index);
        break;
      }
    }
  }
  return args.filter((_, index) => !drop.has(index));
}

/** The one-line message for a Node that is too old, or null when the version is fine. */
export function versionMessage(version) {
  if (!nodeTooOld(version)) return null;
  return `AsItIs needs Node 22.13 or later; you have ${String(version).replace(/^v/, "")}. Install a current Node from https://nodejs.org, then restart Claude Code.`;
}

function main() {
  const tooOld = versionMessage(process.versions.node);
  if (tooOld) fail(tooOld, 1);
  const args = process.argv.slice(2);
  if (args[0] !== "--permission") fail("the launcher must be started with --permission as its first option (see the plugin's .mcp.json).", 2);
  const script = args.findIndex((a) => !a.startsWith("-"));
  if (script < 0 || real(args[script]) !== real(SERVER)) fail(`the launcher only starts ${SERVER}.`, 2);
  const nodeFlags = dedupeReadGrants(args.slice(0, script));
  const child = spawn(process.execPath, [...nodeFlags, ...args.slice(script)], { stdio: "inherit", windowsHide: true });
  const forward = (sig) => () => {
    try {
      child.kill(sig);
    } catch {
      // already gone
    }
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    try {
      process.on(sig, forward(sig));
    } catch {
      // signal not supported on this platform
    }
  }
  child.on("error", (e) => fail(`could not start the server (${e.message}).`, 1));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
