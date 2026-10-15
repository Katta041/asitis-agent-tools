// Audit of .claude/settings.json and MCP config files (F9). Owner: WP6.
//
// Runs only with include "config" (and reads .claude/settings.local.json only with
// "config-local"); without it the server reads no settings at all. Files are opened through
// sandbox.openAs("agent-config", ...), whose policy (policy/agent-config.ts) allows a fixed list of
// root-level files and never ~/.claude.json. Messages carry key paths, hosts and redacted previews,
// never a raw value: file text goes through quote() below (redact.ts plus a mask for long
// token-like runs), and secrets through redactValue().
//
// Vendor facts, all read on 14 October 2026:
// - Hooks, their types and fields, exec and shell form, and workspace trust ("a -p or SDK session
//   ... treats the folder as trusted, so hooks committed in a repository's .claude/settings.json
//   run in a folder you've never trusted"): https://code.claude.com/docs/en/hooks
// - permissions.allow / deny / defaultMode, env, enableAllProjectMcpServers, apiKeyHelper,
//   statusLine and skipDangerousModePermissionPrompt: https://code.claude.com/docs/en/settings-reference
// - Settings files are strict JSON ("a // comment or a trailing comma is a syntax error"):
//   https://code.claude.com/docs/en/settings
// - Rule syntax (Bash(*) equals Bash, ":*" equals a trailing " *", WebFetch(domain:...)):
//   https://code.claude.com/docs/en/permissions
// - .mcp.json format and ${VAR} expansion: https://code.claude.com/docs/en/mcp
// - VS Code .vscode/mcp.json uses the root key "servers", types stdio/http/sse, ${input:...} for
//   secrets: https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
// - Cursor .cursor/mcp.json uses "mcpServers" and ${env:NAME}: https://cursor.com/docs/context/mcp
// - Gemini CLI settings.json mcpServers (command, args, env, url, httpUrl, headers, trust; "trust"
//   bypasses all tool call confirmations): https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
// - CVE-2025-59536 (project code ran before the trust dialog), CVE-2026-21852 (ANTHROPIC_BASE_URL
//   in project settings leaked API keys), CVE-2025-55284 (DNS exfiltration through allowlisted
//   commands), CVE-2025-6514 (mcp-remote 0.0.5 to 0.1.15, OS command injection): NVD and the
//   JFrog advisory https://research.jfrog.com/vulnerabilities/mcp-remote-command-injection-rce-jfsa-2025-001290844/
// - npx installs without a prompt when stdin is not a TTY, which is how MCP clients start
//   servers: https://docs.npmjs.com/cli/commands/npx

import { q } from "../escape.js";
import { nodeAt, parseJsonMap, pointerKey, type JsonLocation, type JsonNode } from "../jsonmap.js";
import type { Issue } from "../lint.js";
import { UserError } from "../paths.js";
import { AGENT_CONFIG_FILES, AGENT_CONFIG_LOCAL_FILE } from "../policy/agent-config.js";
import type { CheckContext, ProjectCheck } from "../project.js";
import { findSecrets, redact, redactValue } from "../redact.js";

type Tool = "claude-settings" | "claude-local" | "claude-mcp" | "cursor" | "vscode" | "gemini";

const TOOL_OF: Record<string, Tool> = {
  ".claude/settings.json": "claude-settings",
  ".claude/settings.local.json": "claude-local",
  ".mcp.json": "claude-mcp",
  ".cursor/mcp.json": "cursor",
  ".vscode/mcp.json": "vscode",
  ".gemini/settings.json": "gemini",
};

const TOOL_NAME: Record<Tool, string> = {
  "claude-settings": "Claude Code",
  "claude-local": "Claude Code",
  "claude-mcp": "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  gemini: "Gemini CLI",
};

/** How each tool reads a variable, for the "move it to an environment variable" hint. */
const ENV_REF: Record<Tool, string> = {
  "claude-settings": "your shell or ~/.claude/settings.json",
  "claude-local": "your shell or ~/.claude/settings.json",
  "claude-mcp": "${NAME}",
  cursor: "${env:NAME}",
  vscode: "${input:name} or ${env:NAME}",
  gemini: "$NAME",
};

// VS Code reads mcp.json as JSON with comments. Gemini CLI strips comments from settings.json.
// Cursor does not document its parser, so it gets the lenient mode too: a false
// config-json-invalid would be worse than a missed one. Claude Code files are strict JSON.
const JSONC: ReadonlySet<Tool> = new Set<Tool>(["vscode", "gemini", "cursor"]);

export const AGENT_CONFIG_CHECK: ProjectCheck = {
  id: "agent-config",
  include: "config",
  ready: true,
  run: async (ctx) => {
    const files = [...AGENT_CONFIG_FILES, ...(ctx.include.has("config-local") ? [AGENT_CONFIG_LOCAL_FILE] : [])];
    const root = ctx.sandbox.primary.real;
    const wanted: string[] = [];
    if (ctx.discovered) {
      for (const rel of files) {
        // A stat, not a read: missing files are skipped quietly.
        const p = await ctx.sandbox.probe(rel, root);
        if (p.state !== "missing") wanted.push(rel);
      }
    } else {
      // Named files only (a pre-commit run passes what changed).
      for (const t of ctx.otherTargets) {
        const lex = ctx.sandbox.lexical(t);
        if (!lex || lex.root !== ctx.sandbox.primary) continue;
        const rel = lex.rel.toLowerCase();
        if (!files.includes(rel)) continue;
        ctx.claim(t);
        if (!wanted.includes(lex.rel)) wanted.push(lex.rel);
      }
    }
    let envFiles: string[] | null = null;
    let workspace: Set<string> | null = null;
    for (const rel of wanted) {
      if (ctx.deadline.expired) {
        ctx.note("The agent config audit stopped at the time limit; some config files were not checked.");
        return;
      }
      let text: string;
      try {
        const f = await ctx.sandbox.openAs("agent-config", rel, { grants: ctx.include });
        text = new TextDecoder("utf-8").decode(f.buf);
      } catch (e) {
        if (e instanceof UserError) {
          ctx.note(`${rel}: not checked (${e.message.replace(/\.$/, "")}).`);
          continue;
        }
        throw e;
      }
      const tool = TOOL_OF[rel.toLowerCase()]!;
      if (tool === "claude-settings" && envFiles === null) envFiles = await listEnvFiles(ctx);
      if (tool !== "claude-settings" && tool !== "claude-local" && workspace === null) workspace = await listWorkspaceDirs(ctx);
      auditFile(ctx, rel, tool, text, envFiles ?? [], workspace ?? new Set());
    }
  },
};

/** .env files at the top of the root, by name only (listDir reads no file). Templates do not count. */
async function listEnvFiles(ctx: CheckContext): Promise<string[]> {
  try {
    const { entries } = await ctx.sandbox.listDir(".", ctx.sandbox.primary.real);
    return entries
      .filter((e) => e.type === "file" || e.type === "symlink")
      .map((e) => e.name)
      .filter((n) => /^\.env(\..+)?$/i.test(n) && !/\.(example|sample|template|dist|defaults?|schema|test|ci)$/i.test(n));
  } catch {
    return [];
  }
}

/**
 * Folder names under the usual monorepo package folders. "npx @scope/mcp-server" in a repo with
 * packages/mcp-server runs the workspace copy from node_modules, not a floating release, so the
 * launcher check skips it. Names only: listDir reads no file.
 */
async function listWorkspaceDirs(ctx: CheckContext): Promise<Set<string>> {
  const out = new Set<string>();
  for (const dir of ["packages", "apps", "tools", "libs", "servers"]) {
    try {
      const { entries } = await ctx.sandbox.listDir(dir, ctx.sandbox.primary.real);
      for (const e of entries) if (e.type === "dir") out.add(e.name.toLowerCase());
    } catch {
      // no such folder
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Long runs of token-like characters with letters and digits: masked even when no known key shape matches. */
const TOKENISH = /[A-Za-z0-9_\-+/=.]{20,}/g;
function maskTokens(text: string): string {
  return text.replace(TOKENISH, (m) => {
    const run = /[A-Za-z0-9]{20,}/.exec(m)?.[0];
    return run && /[0-9]/.test(run) && /[A-Za-z]/.test(run) ? redactValue(m) : m;
  });
}

/** File text for a message: secrets masked, line breaks flattened, at most max characters, escaped and quoted. */
function quote(text: string, max = 60): string {
  const flat = maskTokens(redact(text.replace(/[\r\n]+/g, " ")));
  const cut = flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
  return q(cut, max + 3);
}

/** A name from the file (a server name, an env key) for a message. */
const name = (s: string): string => quote(s, 40);

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1|0\.0\.0\.0|host\.docker\.internal)$/i;

/** Host of an http(s) URL, or null. Uses the WHATWG parser (no network). */
function urlHost(u: string): { scheme: string; host: string } | null {
  try {
    const p = new URL(u);
    if (p.protocol !== "http:" && p.protocol !== "https:") return null;
    return { scheme: p.protocol.slice(0, -1), host: p.hostname };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Shell command analysis, for hooks, settings commands and shell-wrapped MCP launchers.
// Every pattern has bounded repeats and starts on a fixed word, so a scan stays linear.

const FETCH = String.raw`(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)`;
const RUNNER = String.raw`(?:sh|bash|zsh|dash|ksh|fish|python3?|node|perl|ruby|php|iex|invoke-expression|pwsh|powershell)`;
/** curl ... | sh, wget -O- ... | sudo bash, iwr ... | iex */
const PIPE_TO_SHELL = new RegExp(String.raw`\b${FETCH}\b[^|\n]{0,400}\|\s{0,10}(?:sudo\s{1,5})?${RUNNER}\b`, "i");
/** bash -c "$(curl ...)", eval "$(wget ...)", source <(curl ...), sh <(curl ...) */
const SUBST_FETCH = new RegExp(String.raw`\b(?:eval|source|sh|bash|zsh|python3?|node)\b[^\n]{0,20}(?:\$\(|<\(|\x60)\s{0,5}${FETCH}\b`, "i");
/** echo ... | base64 -d | sh, or eval with a base64 decode in the same command */
const B64_TO_SHELL = new RegExp(String.raw`\bbase64\s{1,5}(?:-d|-D|--decode)\b[^\n]{0,300}\|\s{0,10}${RUNNER}\b`, "i");
const EVAL_B64 = /\beval\b[^\n]{0,300}\bbase64\b|\bbase64\b[^\n]{0,300}\beval\b|\bfrombase64string\b/i;
/** A network tool as a command word: at the start, after whitespace, a pipe, ;, &, ( or a path slash. */
const NET_TOOL = /(?:^|[\s|;&(`/])(curl|wget|nc|ncat|netcat|telnet|ssh|scp|sftp|ftp|nslookup|dig|socat)(?=\s|$)/i;
/**
 * A script under the home folder: "~/.claude/hooks/x.sh" as the command, or "$HOME/.../x.py" that
 * the command runs. A home path that is not a script (a log file) does not count.
 */
const HOME_SCRIPT = /(?:^|[\s"'=;&|(])((?:~|\$HOME|\$\{HOME\})\/[^\s"';&|)]{1,200}?\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1))(?=$|[\s"';&|)])/;

interface ShellRisk {
  severity: "error" | "warning";
  what: string;
  /** The what already quotes the relevant part, so the message does not quote the command again. */
  quoted?: boolean;
  /** What to do, when it differs from the default for the severity. */
  advice?: string;
}

/** "(<command>)" unless the risk already quoted what matters. */
const shown = (risk: ShellRisk, cmd: string): string => (risk.quoted ? "" : ` (${quote(cmd)})`);
const adviceFor = (risk: ShellRisk): string => risk.advice ?? (risk.severity === "error" ? "commit the script to the repo and call that instead" : "check that this is intended");

/** The most serious risk in a shell command string, or null. */
function shellRisk(cmd: string): ShellRisk | null {
  if (PIPE_TO_SHELL.test(cmd) || SUBST_FETCH.test(cmd)) return { severity: "error", what: "downloads code and runs it" };
  if (B64_TO_SHELL.test(cmd) || EVAL_B64.test(cmd)) return { severity: "error", what: "decodes base64 and runs the result" };
  const launch = launcherIn(tokenize(cmd), true);
  if (launch && !launch.pinned) return { severity: "warning", what: `runs ${launch.display} without a pinned version, so whatever is published next runs` };
  const net = NET_TOOL.exec(cmd);
  if (net) return { severity: "warning", what: `calls the network with ${net[1]!.toLowerCase()}` };
  // A URL on its own is not flagged: hooks print install links in messages, and that is not a
  // network call. Only the tools above count.
  const home = HOME_SCRIPT.exec(cmd);
  if (home) return { severity: "warning", what: `runs ${quote(home[1]!, 50)} from the home folder, outside the repo, so reviewers cannot see what it does and it differs on each machine`, quoted: true, advice: "commit the script to the repo or move the hook to your user settings" };
  return null;
}

/** Splits a command line on whitespace, dropping simple quotes. Good enough to find a launcher and its package. */
function tokenize(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.slice(0, 4096).matchAll(/"([^"]{0,2000})"|'([^']{0,2000})'|(\S{1,2000})/g)) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

const baseName = (t: string): string => {
  const b = t.split(/[\\/]/).pop() ?? t;
  return b.toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/, "");
};

// ---------------------------------------------------------------------------------------------
// Package launchers: npx, bunx, pnpm dlx, yarn dlx, npm exec, uvx, uv tool run, pipx run, docker run.

interface Launch {
  /** "npx -y example-mcp" style text for the message (already quoted). */
  display: string;
  pkg: string;
  pinned: boolean;
  /** For an exact npm version: the version. */
  version?: string;
  ecosystem: "npm" | "python" | "docker";
  /** npx -y / --yes, or a launcher that never asks. */
  noPrompt: boolean;
}

const NPM_EXACT = /^(?:@[^/@\s]+\/)?[^@\s/]+@v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]{1,100})?$/;
const PY_EXACT = /^[A-Za-z0-9_.\-[\],]+(?:===?\s*\d[^\s,;]*|@\s*v?\d+(?:\.\d+){0,3}[0-9A-Za-z.+-]*)$/;

/** True when a package spec is not a registry name (a path, a URL, a git spec, a variable). */
function notRegistry(spec: string): boolean {
  return /^[./~\\]|^[A-Za-z]:[\\/]|^(?:file|git\+|git:|github:|gitlab:|bitbucket:|https?:|link:|workspace:)|\$|%/.test(spec) || spec.includes("\\") || /\.(?:tgz|tar\.gz|whl|js|mjs|cjs|ts|py)$/i.test(spec);
}

/** A git source (npm "github:user/repo", "git+https://...", uv "git+https://...@ref"). */
const GIT_SPEC = /^(?:git\+|git:|github:|gitlab:|bitbucket:)/i;
/** A git source pinned to a commit or a version tag: "#<sha>", "@<sha>", "#v1.2.3", "@v1.2". */
const GIT_PINNED = /[#@](?:[0-9a-f]{7,40}|v?\d+\.\d+(?:\.\d+)?[0-9A-Za-z.+-]*)$/i;

/** A relative or absolute file path argument (./server.ts, src/index.js). */
const LOCAL_FILE_ARG = /^(?:\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])|^[\w.-]+[\\/][\w./\\-]+\.(?:m?[jt]s|cjs|py)$/;

/**
 * Finds a package launcher in tokens and says whether its package is pinned. inShell: the tokens
 * come from a hook command, where "npx tool" without -y usually runs a dependency already
 * installed in node_modules; only a launcher that installs without asking counts there.
 */
function launcherIn(tokens: string[], inShell: boolean): Launch | null {
  for (let i = 0; i < tokens.length && i < 64; i++) {
    const b = baseName(tokens[i]!);
    // At a command position only: the first token, or after a shell separator.
    const prev = i === 0 ? "" : tokens[i - 1]!;
    const atCommand = i === 0 || /^(?:&&|\|\||;|\||sudo|exec|env|then|do|\/c|-c)$/i.test(prev) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(prev) || prev.endsWith(";");
    if (!atCommand) continue;
    let rest: string[] | null = null;
    let label = "";
    let eco: Launch["ecosystem"] = "npm";
    if (b === "npx" || b === "bunx" || b === "pnpx") {
      rest = tokens.slice(i + 1);
      label = b;
    } else if ((b === "pnpm" || b === "yarn") && tokens[i + 1] === "dlx") {
      rest = tokens.slice(i + 2);
      label = `${b} dlx`;
    } else if (b === "bun" && tokens[i + 1] === "x") {
      rest = tokens.slice(i + 2);
      label = "bun x";
    } else if (b === "npm" && (tokens[i + 1] === "exec" || tokens[i + 1] === "x")) {
      rest = tokens.slice(i + 2);
      label = `npm ${tokens[i + 1]}`;
    } else if (b === "uvx") {
      rest = tokens.slice(i + 1);
      label = "uvx";
      eco = "python";
    } else if (b === "uv" && tokens[i + 1] === "tool" && tokens[i + 2] === "run") {
      rest = tokens.slice(i + 3);
      label = "uv tool run";
      eco = "python";
    } else if (b === "pipx" && tokens[i + 1] === "run") {
      rest = tokens.slice(i + 2);
      label = "pipx run";
      eco = "python";
    } else if ((b === "docker" || b === "podman") && tokens[i + 1] === "run") {
      return dockerImage(tokens.slice(i + 2), b);
    }
    if (!rest) continue;
    const l = eco === "npm" ? npmPackage(rest) : pyPackage(rest);
    if (!l) return null;
    const noPrompt = eco === "python" || label !== "npx" || l.yes;
    // In a hook, plain "npx prettier" runs the copy in node_modules; only -y and friends install.
    if (inShell && label === "npx" && !l.yes) return null;
    // "npx tsx ./server.ts": a runner for a local file, almost always a dev dependency of the repo.
    if (label === "npx" && !l.yes && l.next !== undefined && LOCAL_FILE_ARG.test(l.next)) return null;
    const display = quote(`${label}${l.yes && label === "npx" ? " -y" : ""} ${l.pkg}`, 70);
    const m = NPM_EXACT.exec(l.pkg);
    const pinned = GIT_SPEC.test(l.pkg) ? GIT_PINNED.test(l.pkg) : eco === "npm" ? !!m : PY_EXACT.test(l.pkg);
    return { display, pkg: l.pkg, pinned, ecosystem: eco, noPrompt, ...(m ? { version: `${m[1]}.${m[2]}.${m[3]}` } : {}) };
  }
  return null;
}

/** The package an npm-style launcher runs, from the tokens after it. */
function npmPackage(rest: string[]): { pkg: string; yes: boolean; next?: string } | null {
  let yes = false;
  let pkg: string | undefined;
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j]!;
    if (t === "--") {
      if (!pkg && rest[j + 1]) pkg = rest[j + 1];
      break;
    }
    if (t === "-y" || t === "--yes") {
      yes = true;
      continue;
    }
    if (t === "-p" || t === "--package") {
      pkg ??= rest[j + 1];
      j++;
      continue;
    }
    if (t.startsWith("--package=")) {
      pkg ??= t.slice("--package=".length);
      continue;
    }
    if (t === "-c" || t === "--call") return null; // a command string, not a package
    if (t.startsWith("-")) continue; // other flags take no value (--quiet, --no-install, --registry=...)
    if (pkg === undefined) {
      pkg = t;
      return notRegistry(t) && !GIT_SPEC.test(t) ? null : { pkg: t, yes, ...(rest[j + 1] !== undefined ? { next: rest[j + 1]! } : {}) };
    }
    break;
  }
  if (pkg === undefined || (notRegistry(pkg) && !GIT_SPEC.test(pkg))) return null;
  return { pkg, yes };
}

const PY_VALUE_FLAGS = new Set(["--from", "--with", "--with-editable", "--with-requirements", "--python", "-p", "--index-url", "--extra-index-url", "--index", "--default-index", "--spec", "--pip-args", "-c", "--constraint", "--directory", "--project"]);

/** The package a Python launcher runs: --from / --spec when given, else the first positional. */
function pyPackage(rest: string[]): { pkg: string; yes: boolean; next?: string } | null {
  let from: string | undefined;
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j]!;
    if (t === "--") break;
    if (t === "--from" || t === "--spec") {
      from = rest[j + 1];
      j++;
      continue;
    }
    if (t.startsWith("--from=") || t.startsWith("--spec=")) {
      from = t.slice(t.indexOf("=") + 1);
      continue;
    }
    if (PY_VALUE_FLAGS.has(t)) {
      j++;
      continue;
    }
    if (t.startsWith("-")) continue;
    const pkg = from ?? t;
    if (notRegistry(pkg) && !GIT_SPEC.test(pkg)) return null;
    return { pkg, yes: true };
  }
  if (from && (!notRegistry(from) || GIT_SPEC.test(from))) return { pkg: from, yes: true };
  return null;
}

const DOCKER_BOOL = new Set(["-i", "-t", "-it", "-ti", "--rm", "-d", "--detach", "--init", "--privileged", "--read-only", "-q", "--quiet", "--interactive", "--tty", "-P", "--publish-all", "--sig-proxy"]);

/** The image of a docker run, pinned when it has a digest or a tag other than latest. */
function dockerImage(rest: string[], bin: string): Launch | null {
  for (let j = 0; j < rest.length; j++) {
    const t = rest[j]!;
    if (DOCKER_BOOL.has(t) || (t.startsWith("--") && t.includes("="))) continue;
    if (/^-[a-zA-Z]{2,}$/.test(t) && [...t.slice(1)].every((c) => "itdPq".includes(c))) continue; // combined short flags like -it
    if (t.startsWith("-")) {
      j++; // a flag with a value: -e KEY, -v a:b, --name x
      continue;
    }
    if (notRegistry(t) && !/^[a-z0-9]/.test(t)) return null;
    if (t.includes("$")) return null;
    const lastSlash = t.lastIndexOf("/");
    const tagAt = t.indexOf(":", lastSlash + 1);
    const pinned = t.includes("@sha256:") || (tagAt !== -1 && t.slice(tagAt + 1) !== "latest");
    return { display: quote(`${bin} run ${t}`, 70), pkg: t, pinned, ecosystem: "docker", noPrompt: true };
  }
  return null;
}

/** "1.2.3" < "0.1.16"? Plain numeric comparison of three parts. */
function versionBelow(v: string, min: [number, number, number]): boolean {
  const p = v.split(".").map(Number);
  for (let k = 0; k < 3; k++) {
    if ((p[k] ?? 0) !== min[k]) return (p[k] ?? 0) < min[k]!;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Secrets

const SECRET_KEY = /(?:token|secret|passw(?:or)?d|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth|credential|client[_-]?secret)/i;
const PLACEHOLDER = /your|here|example|xxx|placeholder|changeme|change[_-]?me|replace|dummy|fake|sample|redacted|todo|insert|<|>|\.\.\./i;

/** A secret in one config string: a known key shape (error), or a long literal under a secret-looking name (warning). */
function secretIn(value: string, keyName: string | undefined): { type: string; preview: string; severity: "error" | "warning" } | null {
  const shaped = findSecrets(value, 1)[0];
  if (shaped) return { type: shaped.type, preview: redactValue(value.slice(shaped.start, shaped.end)), severity: "error" };
  if (!keyName || !SECRET_KEY.test(keyName)) return null;
  let v = value.trim();
  const bearer = /^(?:bearer|token|basic)\s+(\S+)$/i.exec(v);
  if (bearer) v = bearer[1]!;
  if (v.length < 20 || /\s/.test(v) || /[${}%]/.test(v) || PLACEHOLDER.test(v)) return null;
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return null;
  if (/^(?:https?:|file:|\/|\.)/i.test(v)) return null;
  if (new Set(v).size < 8) return null;
  return { type: "credential", preview: redactValue(v), severity: "warning" };
}

// ---------------------------------------------------------------------------------------------
// The audit of one file

interface FileCtx {
  ctx: CheckContext;
  /** Monorepo package folder names (listWorkspaceDirs). */
  workspace: ReadonlySet<string>;
  rel: string;
  tool: Tool;
  root: JsonNode;
  locate: (node: JsonNode) => JsonLocation;
  lines: string[];
}

function emit(fc: FileCtx, ptr: Array<string | number>, issue: Omit<Issue, "line">, useKey = true): void {
  const node = fc.locate(nodeAt(fc.root, ptr.length ? "/" + ptr.map((p) => pointerKey(String(p))).join("/") : "") ?? fc.root);
  const line = useKey && node.keyLine !== undefined ? node.keyLine : node.line;
  const column = useKey && node.keyColumn !== undefined ? node.keyColumn : node.column;
  const sameLine = node.endLine === line;
  const full: Issue = { ...issue, line, column, endLine: sameLine ? node.endLine : line, endColumn: sameLine ? node.endColumn : (fc.lines[line - 1] ?? "").length + 1 };
  fc.ctx.report(fc.rel, full, { kind: "agent-config", lineText: (l) => fc.lines[l - 1] ?? "" });
}

function auditFile(ctx: CheckContext, rel: string, tool: Tool, text: string, envFiles: readonly string[], workspace: ReadonlySet<string>): void {
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const lineText = (l: number): string => lines[l - 1] ?? "";
  const parsed = parseJsonMap(text, { jsonc: JSONC.has(tool) });
  const app = TOOL_NAME[tool];
  if (!parsed.ok) {
    ctx.report(
      rel,
      {
        severity: "error",
        rule: "config-json-invalid",
        message: `Not valid JSON at line ${parsed.line}, column ${parsed.column}: ${parsed.message}. ${app} ${tool.startsWith("claude-") && tool !== "claude-mcp" ? "skips a settings file it cannot parse" : "drops the servers in a file it cannot parse"}, so fix the syntax`,
        line: parsed.line,
        column: parsed.column,
        endLine: parsed.line,
        endColumn: parsed.column + 1,
      },
      { kind: "agent-config", lineText },
    );
    return;
  }
  const fc: FileCtx = { ctx, workspace, rel, tool, root: parsed.root, locate: parsed.locate, lines };
  if (!isObj(parsed.value)) {
    emit(fc, [], { severity: "error", rule: "config-json-invalid", message: `The file must be a JSON object ({ ... }) at the top level; ${app} ignores anything else` });
    return;
  }
  const doc = parsed.value;
  if (tool === "claude-settings" || tool === "claude-local") auditClaudeSettings(fc, doc, envFiles);
  if (tool !== "claude-settings" && tool !== "claude-local") auditMcpServers(fc, doc);
}

// --- Claude Code settings -------------------------------------------------------------------

function auditClaudeSettings(fc: FileCtx, doc: Obj, envFiles: readonly string[]): void {
  const project = fc.tool === "claude-settings";
  auditHooks(fc, doc);
  auditSettingsCommands(fc, doc);
  auditPermissions(fc, doc);
  auditEnv(fc, doc);

  // settings-reference, enableAllProjectMcpServers: "Approve every MCP server defined in project
  // .mcp.json files without a prompt". In a committed file it means a server added to .mcp.json
  // later (by a PR or by injected text) starts without anyone approving it. Claude Code writes it
  // to settings.local.json itself when a user picks "approve all", so only the project file counts.
  if (project && doc["enableAllProjectMcpServers"] === true) {
    emit(fc, ["enableAllProjectMcpServers"], {
      severity: "warning",
      rule: "sec-hook-config",
      message: "enableAllProjectMcpServers is true in the shared settings, so any server added to .mcp.json later starts without an approval prompt for everyone who trusts this folder; approve servers one by one with enabledMcpjsonServers instead",
    });
  }

  // settings-reference, skipDangerousModePermissionPrompt: skips the confirmation before
  // bypassPermissions; honored from user, local or managed settings, not the project file.
  if (!project && doc["skipDangerousModePermissionPrompt"] === true) {
    emit(fc, ["skipDangerousModePermissionPrompt"], {
      severity: "warning",
      rule: "sec-permission-mode",
      message: "skipDangerousModePermissionPrompt is true, so this folder can enter bypassPermissions mode (every tool runs without asking) with no confirmation; remove it unless you work in a throwaway container",
    });
  }

  // settings-reference, permissions.deny: "Use it for files that hold API keys, secrets, or
  // environment values". Only when a .env file actually sits in the folder, so a repo without
  // secrets on disk gets no note.
  if (project && envFiles.length) {
    const perms = isObj(doc["permissions"]) ? doc["permissions"] : {};
    const rules = [...(Array.isArray(perms["deny"]) ? perms["deny"] : []), ...(Array.isArray(perms["ask"]) ? perms["ask"] : [])].filter((r): r is string => typeof r === "string");
    const covered = rules.some((r) => /\.env|secret/i.test(r) || /^Read(?:\(\*{0,2}\))?$/.test(r.trim()));
    if (!covered) {
      emit(fc, isObj(doc["permissions"]) ? ["permissions"] : [], {
        severity: "info",
        rule: "sec-no-secret-deny",
        message: `This folder has ${name(envFiles[0]!)}${envFiles.length > 1 ? ` and ${envFiles.length - 1} more .env file${envFiles.length > 2 ? "s" : ""}` : ""} but no permissions.deny rule for it, and Claude Code reads project files without asking; add "Read(./.env)" and "Read(./.env.*)" to permissions.deny`,
      });
    }
  }
}

function auditHooks(fc: FileCtx, doc: Obj): void {
  const hooks = doc["hooks"];
  if (!isObj(hooks)) return;
  let plain = 0;
  const plainEvents = new Set<string>();
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((g, gi) => {
      if (!isObj(g) || !Array.isArray(g["hooks"])) return;
      (g["hooks"] as unknown[]).forEach((h, hi) => {
        if (!isObj(h)) return;
        const ptr = ["hooks", event, gi, "hooks", hi];
        const type = str(h["type"]) ?? "command";
        if (type === "command") {
          const command = str(h["command"]);
          if (command === undefined) return;
          const args = Array.isArray(h["args"]) ? (h["args"] as unknown[]).filter((a): a is string => typeof a === "string") : [];
          const full = args.length ? `${command} ${args.join(" ")}` : command;
          const risk = shellRisk(full);
          if (risk) {
            emit(fc, [...ptr, "command"], {
              severity: risk.severity,
              rule: "sec-hook-config",
              message: `${esc40(event)} hook ${risk.what}${shown(risk, full)}; project hooks run on every developer's machine and claude -p starts them without the trust prompt, so ${adviceFor(risk)}`,
            });
          } else {
            plain++;
            plainEvents.add(event);
          }
        } else if (type === "http") {
          // hooks, HTTP hook fields: Claude Code POSTs the event's JSON input to url.
          const url = str(h["url"]);
          const host = url ? urlHost(url) : null;
          if (!host || LOOPBACK.test(host.host)) {
            plain++;
            plainEvents.add(event);
            return;
          }
          emit(fc, [...ptr, "url"], {
            severity: "warning",
            rule: "sec-hook-config",
            message: `${esc40(event)} hook sends each event's data (prompts, tool input and output) to ${name(host.host)}${host.scheme === "http" ? " over plain http, which anyone on the network can read" : ""}; check that this host should receive it`,
          });
        }
      });
    });
  }
  if (plain) {
    const events = [...plainEvents].slice(0, 4).map((e) => esc40(e)).join(", ");
    emit(fc, ["hooks"], {
      severity: "info",
      rule: "sec-hook-config",
      message: `${plain} hook command${plain === 1 ? "" : "s"} (${events}${plainEvents.size > 4 ? ", ..." : ""}) ${plain === 1 ? "runs" : "run"} on the developer's machine; claude -p starts ${plain === 1 ? "it" : "them"} without the trust prompt, so review ${plain === 1 ? "it" : "them"} like code`,
      // Fired on 16 of 43 repos with any hooks: an inventory, so shown only with extends: strict.
      strictOnly: true,
    });
  }
}

const esc40 = (s: string): string => (/^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : name(s));

/** apiKeyHelper, awsAuthRefresh, awsCredentialExport, otelHeadersHelper and statusLine run shell commands too. */
function auditSettingsCommands(fc: FileCtx, doc: Obj): void {
  const cmds: Array<[Array<string | number>, string]> = [];
  for (const k of ["apiKeyHelper", "awsAuthRefresh", "awsCredentialExport", "otelHeadersHelper"]) {
    const v = str(doc[k]);
    if (v !== undefined) cmds.push([[k], v]);
  }
  if (isObj(doc["statusLine"]) && typeof doc["statusLine"]["command"] === "string") cmds.push([["statusLine", "command"], doc["statusLine"]["command"]]);
  for (const [ptr, cmd] of cmds) {
    const risk = shellRisk(cmd);
    if (!risk) continue;
    emit(fc, ptr, {
      severity: risk.severity,
      rule: "sec-hook-config",
      message: `${ptr.join(".")} ${risk.what}${shown(risk, cmd)}; Claude Code runs this command itself, so ${adviceFor(risk)}`,
    });
  }
}

/** Shell and interpreter commands that run anything they are given. */
const INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "pwsh", "powershell", "cmd", "python", "python3", "node", "deno", "bun", "ruby", "perl", "php", "osascript", "eval", "exec", "sudo", "env", "xargs", "npx", "bunx", "uvx", "pnpx"]);
/** Two-word commands that send data out: push to any remote, call any GitHub API endpoint. */
const NET_TWO: Record<string, string> = {
  "git push": "push to any remote without asking, so injected text can send the code anywhere",
  "gh api": "call any GitHub API endpoint without asking, writes included, so injected text can post repository data elsewhere",
  "gh gist": "create gists without asking, so injected text can publish files",
};
/** Two-word commands that run any package or script they are given. */
const RUN_ANY = new Set(["uv run", "uv tool", "npm exec", "pnpm dlx", "pnpm exec", "yarn dlx", "bun x", "poetry run", "pipx run", "deno run", "pdm run", "hatch run"]);
/** Network and DNS tools: an allow rule for them lets injected text send data out (CVE-2025-55284). */
const NET_TOOLS = new Set(["curl", "wget", "nc", "ncat", "netcat", "ssh", "scp", "sftp", "rsync", "ftp", "telnet", "ping", "nslookup", "dig", "host", "socat"]);

function auditPermissions(fc: FileCtx, doc: Obj): void {
  const perms = doc["permissions"];
  if (!isObj(perms)) return;
  // settings-reference, permissions.defaultMode: "auto and bypassPermissions don't take effect
  // from project or local settings ... Before v2.1.257, bypassPermissions took effect from any file."
  if (perms["defaultMode"] === "bypassPermissions") {
    emit(fc, ["permissions", "defaultMode"], {
      severity: "warning",
      rule: "sec-permission-mode",
      message: `defaultMode is bypassPermissions, which runs every tool without asking; Claude Code 2.1.257 and later ignore it in ${fc.tool === "claude-local" ? "local" : "project"} settings but older versions honor it, so remove it and use --permission-mode for a single session in a sandbox`,
    });
  }
  const allow = perms["allow"];
  if (!Array.isArray(allow)) return;
  allow.forEach((entry, idx) => {
    if (typeof entry !== "string") return;
    const r = entry.trim();
    const m = /^([A-Za-z][A-Za-z0-9_]*)(?:\((.*)\))?$/s.exec(r);
    if (!m) return;
    const toolName = m[1]!;
    const spec = m[2]?.trim();
    const ptr = ["permissions", "allow", idx];
    // permissions: "Bash(*) is equivalent to Bash and matches all Bash commands"; PowerShell has
    // the same shape. ":*" alone is the same trailing wildcard.
    if (toolName === "Bash" || toolName === "PowerShell") {
      if (spec === undefined || spec === "" || /^(?:\*|:\*|\s*\*\s*)$/.test(spec)) {
        emit(fc, ptr, { severity: "error", rule: "sec-permission-allow", message: `${quote(r)} lets Claude run any ${toolName === "Bash" ? "shell" : "PowerShell"} command without asking, so text it reads can run commands on this machine; list the specific commands instead, such as "Bash(npm test)"` }, false);
        return;
      }
      if (!spec.includes("*")) return; // an exact command is a scoped grant
      const words = spec.split(/[\s:]/);
      const first = words[0]!.toLowerCase();
      const after = spec.slice(first.length);
      const bin = baseName(first);
      const two = `${bin} ${(words[1] ?? "").toLowerCase()}`;
      const netTwo = NET_TWO[two];
      if (netTwo && /\*/.test(spec.slice(first.length))) {
        emit(fc, ptr, { severity: "warning", rule: "sec-permission-allow", message: `${quote(r)} lets Claude ${netTwo}; allow the exact commands you need instead` }, false);
        return;
      }
      if (NET_TOOLS.has(bin)) {
        emit(fc, ptr, { severity: "warning", rule: "sec-permission-allow", message: `${quote(r)} lets Claude run ${bin} with any arguments without asking; injected text can use it to send files out (CVE-2025-55284 did this with ping and nslookup), so allow exact commands or use WebFetch(domain:...)` }, false);
        return;
      }
      // Only the bare wildcard after an interpreter: "python -m pytest *" is scoped and fine.
      const bareWildcard = /^(?::\*|\s*\*|\s+\*\s*)$/;
      const runner = INTERPRETERS.has(bin) && bareWildcard.test(after) ? bin : RUN_ANY.has(two) && bareWildcard.test(spec.slice(spec.toLowerCase().indexOf(two.split(" ")[1]!, first.length) + two.split(" ")[1]!.length)) ? two : null;
      if (runner) {
        const ext = runner.startsWith("python") ? "py" : runner === "node" ? "js" : ["sh", "bash", "zsh"].includes(runner) ? "sh" : null;
        const fix = ext ? `allow the specific scripts instead, such as "Bash(${runner} scripts/check.${ext})"` : "allow the exact commands you need instead";
        emit(fc, ptr, { severity: "warning", rule: "sec-permission-allow", message: `${quote(r)} lets Claude run any code through ${runner} without asking, which is the same as allowing every command; ${fix}` }, false);
      }
      return;
    }
    // permissions: a bare WebFetch and WebFetch(domain:*) both cover every URL.
    if (toolName === "WebFetch" && (spec === undefined || spec === "" || spec === "*" || /^domain:\s*\*$/.test(spec))) {
      emit(fc, ptr, { severity: "warning", rule: "sec-permission-allow", message: `${quote(r)} lets Claude fetch any URL without asking, so injected text can send data to any host in the URL; list the domains instead, such as "WebFetch(domain:docs.example.com)"` }, false);
    }
  });
}

/** Anthropic API base URLs that send requests (and the key) somewhere else. */
const BASE_URL_KEY = /^ANTHROPIC_[A-Z_]*BASE_URL$/;
const VENDOR_HOST = /(?:^|\.)(?:anthropic\.com|claude\.ai|amazonaws\.com|googleapis\.com|azure\.com|microsoft\.com)$/i;

function auditEnv(fc: FileCtx, doc: Obj): void {
  const env = doc["env"];
  if (!isObj(env)) return;
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string") continue;
    // CVE-2026-21852: ANTHROPIC_BASE_URL in a project's settings sent API requests, with the key,
    // to the attacker's host. settings-reference, env: project values apply after trust (or at once
    // in -p mode). A local file is the user's own proxy choice, so only the project file counts.
    if (fc.tool === "claude-settings" && BASE_URL_KEY.test(k) && !v.includes("$")) {
      const h = urlHost(v);
      if (h && !LOOPBACK.test(h.host) && !VENDOR_HOST.test(h.host)) {
        emit(fc, ["env", k], {
          severity: "warning",
          rule: "sec-hook-config",
          message: `env.${k} sends every API request, with each developer's API key, to ${name(h.host)}; CVE-2026-21852 used this setting to steal keys, so keep gateway settings in user or managed settings unless the whole team must use this host`,
        });
      }
    }
    secretCheck(fc, ["env", k], v, k, `env.${k}`);
  }
}

// --- MCP servers ------------------------------------------------------------------------------

function auditMcpServers(fc: FileCtx, doc: Obj): void {
  // Claude Code, Cursor and Gemini CLI use "mcpServers"; VS Code uses "servers".
  for (const rootKey of ["mcpServers", "servers"]) {
    const servers = doc[rootKey];
    if (!isObj(servers)) continue;
    for (const [srv, entry] of Object.entries(servers)) {
      if (isObj(entry)) auditServer(fc, [rootKey, srv], srv, entry);
    }
  }
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "cmd", "powershell", "pwsh"]);

function auditServer(fc: FileCtx, base: string[], srv: string, entry: Obj): void {
  const label = `Server ${name(srv)}`;

  // Gemini CLI: trust "bypasses all tool call confirmations for this server".
  if (fc.tool === "gemini" && entry["trust"] === true) {
    emit(fc, [...base, "trust"], { severity: "warning", rule: "sec-permission-allow", message: `${label} has trust: true, so Gemini CLI runs every tool it offers without asking; remove it and approve tools as they come up` });
  }

  // Remote servers: url (all), httpUrl and serverUrl (Gemini CLI, VS Code older form).
  for (const k of ["url", "httpUrl", "serverUrl"]) {
    const u = str(entry[k]);
    if (u === undefined) continue;
    const h = urlHost(u);
    if (h && h.scheme === "http" && !LOOPBACK.test(h.host)) {
      emit(fc, [...base, k], { severity: "warning", rule: "sec-mcp-launcher", message: `${label} connects to ${name(h.host)} over plain http, so anyone on the network can read or change the traffic, tokens included; use https` });
    }
    secretCheck(fc, [...base, k], u, k, `${srv}.${k}`);
  }

  // Local servers: command plus args.
  const command = str(entry["command"]);
  const args = Array.isArray(entry["args"]) ? (entry["args"] as unknown[]) : [];
  if (command !== undefined) {
    const argStrings = args.filter((a): a is string => typeof a === "string");
    const tokens = argStrings.length || !/\s/.test(command.trim()) ? [command, ...argStrings] : tokenize(command);
    auditLaunch(fc, [...base, "command"], label, tokens);
    // URLs in args (mcp-remote https://..., --url http://...).
    args.forEach((a, i) => {
      if (typeof a !== "string") return;
      const h = /^https?:\/\//i.test(a) ? urlHost(a) : null;
      if (h && h.scheme === "http" && !LOOPBACK.test(h.host)) {
        emit(fc, [...base, "args", i], { severity: "warning", rule: "sec-mcp-launcher", message: `${label} connects to ${name(h.host)} over plain http, so anyone on the network can read or change the traffic, tokens included; use https` });
      }
      const prev = i > 0 && typeof args[i - 1] === "string" ? (args[i - 1] as string) : "";
      const flag = /^--?([A-Za-z0-9_-]{1,40})=(.*)$/s.exec(a);
      if (flag) secretCheck(fc, [...base, "args", i], flag[2]!, flag[1], `${srv} argument --${flag[1]}`);
      else secretCheck(fc, [...base, "args", i], a, /^--?[A-Za-z0-9_-]{1,40}$/.test(prev) ? prev.replace(/^-+/, "") : undefined, `${srv} argument ${i + 1}`);
    });
  }

  for (const k of ["env", "headers"]) {
    const block = entry[k];
    if (!isObj(block)) continue;
    for (const [ek, ev] of Object.entries(block)) {
      if (typeof ev === "string") secretCheck(fc, [...base, k, ek], ev, ek, `${srv}.${k}.${ek}`);
    }
  }
}

function auditLaunch(fc: FileCtx, ptr: Array<string | number>, label: string, tokens: string[]): void {
  if (!tokens.length) return;
  const b = baseName(tokens[0]!);
  // A shell wrapper: look at the command string it runs. sh -c "..." / cmd /c npx ... / pwsh -Command "..."
  if (SHELLS.has(b)) {
    const flagAt = tokens.findIndex((t, i) => i > 0 && /^(?:-c|\/c|\/k|-command|-c[a-z]*)$/i.test(t));
    if (flagAt === -1) return;
    const inner = tokens.slice(flagAt + 1).join(" ");
    const risk = PIPE_TO_SHELL.test(inner) || SUBST_FETCH.test(inner) ? "downloads code and runs it" : B64_TO_SHELL.test(inner) || EVAL_B64.test(inner) ? "decodes base64 and runs the result" : null;
    if (risk) {
      emit(fc, ptr, { severity: "error", rule: "sec-mcp-launcher", message: `${label} starts through a shell that ${risk} (${quote(inner)}); the code can change at any time after you approve the server, so commit it or install a pinned package instead` });
      return;
    }
    auditLaunch(fc, ptr, label, b === "cmd" ? tokens.slice(flagAt + 1) : tokenize(inner));
    return;
  }
  const l = launcherIn(tokens, false);
  if (!l) return;
  // CVE-2025-6514: mcp-remote 0.0.5 to 0.1.15 runs OS commands from a malicious server's
  // authorization_endpoint; fixed in 0.1.16.
  if (/^mcp-remote@/.test(l.pkg) && l.version && versionBelow(l.version, [0, 1, 16])) {
    emit(fc, ptr, { severity: "error", rule: "sec-mcp-launcher", message: `${label} pins mcp-remote ${l.version}, which lets a malicious server run commands on this machine (CVE-2025-6514); use mcp-remote 0.1.16 or later` });
    return;
  }
  if (l.pinned) return;
  if (l.ecosystem === "npm" && !GIT_SPEC.test(l.pkg)) {
    const bare = l.pkg.replace(/^@[^/]+\//, "").replace(/@[^@]*$/, "").toLowerCase();
    if (fc.workspace.has(bare)) return; // the repo's own workspace package
  }
  const fix = GIT_SPEC.test(l.pkg) ? "pin a commit or release tag at the end of the git URL (@<commit>)" : l.ecosystem === "docker" ? "pin the image by digest (image@sha256:...) or a version tag" : l.ecosystem === "python" ? "pin an exact version, such as \"package==1.2.3\"" : "pin an exact version, such as \"package@1.2.3\"";
  const latest = /@latest$/i.test(l.pkg) ? " (@latest)" : "";
  emit(fc, ptr, {
    severity: "warning",
    rule: "sec-mcp-launcher",
    message: `${label} runs ${l.display} with no pinned version${latest}, so a new release runs ${l.noPrompt ? "without any prompt " : ""}after you approved this server; ${fix}`,
  });
}

function secretCheck(fc: FileCtx, ptr: Array<string | number>, value: string, keyName: string | undefined, where: string): void {
  const s = secretIn(value, keyName);
  if (!s) return;
  const at = /^[A-Za-z0-9_.$ -]{1,80}$/.test(where) ? where : quote(where, 60);
  const what = s.type === "credential" ? "what looks like a credential" : `a ${s.type}`;
  emit(fc, ptr, {
    severity: s.severity,
    rule: "sec-mcp-inline-secret",
    message:
      fc.tool === "claude-local"
        ? `${at} holds ${what} in plain text (${s.preview}); this file is easy to commit or copy by mistake, so move the value to your shell environment`
        : `${at} holds ${what} in plain text (${s.preview}); anyone who can read the repo can use it, so revoke it, then read it from ${ENV_REF[fc.tool]} instead`,
  });
}
