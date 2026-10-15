// Entry point of the asitis CLI (bin "asitis"). Owner: WP1. docs/cli-contract.md is the spec.
//
//   asitis lint [paths...] [options]    lint steering files, exit 0, 1, 2 or 3
//   asitis budget [file] [options]      what each agent loads every session
//
// Exit codes: 0 clean, 1 findings at or above --fail-on, 2 something the user can fix (one line on
// stderr, nothing on stdout), 3 a bug in asitis (one line, stack only with ASITIS_DEBUG=1). The
// CLI reads through the same Sandbox as the MCP server and prints to stdout and stderr only.

import path from "node:path";
import { baselineOf } from "../baseline.js";
import { hiddenTotal } from "../config.js";
import { Deadline } from "../discover.js";
import { esc } from "../escape.js";
import { SEVERITY_RANK, buildReport, type Finding } from "../findings.js";
import { attachFixes, fixPreview } from "../fix.js";
import { formatGithub } from "../format/github.js";
import { formatJson } from "../format/json.js";
import { formatSarif } from "../format/sarif.js";
import { formatText } from "../format/text.js";
import { Sandbox, UserError } from "../paths.js";
import { lintProject } from "../project.js";
import { VERSION } from "../version.js";
import { parse, type BudgetArgs, type FailOn, type LintArgs } from "./args.js";
import { fileBudgetReport, projectBudgetReport } from "./budget.js";

/** Exit codes. 2 is anything the user can fix; 3 is a bug in asitis. */
export const EXIT = { ok: 0, findings: 1, usage: 2, internal: 3 } as const;

export const ISSUES_URL = "https://github.com/Katta041/asitis-agent-tools/issues";

/** Same floor as engines in package.json and the plugin launcher. */
const MIN_NODE = [22, 13, 0] as const;

/** Five minutes for one run; a run cut short exits 2, never 0. */
const RUN_BUDGET_MS = 300_000;

export const HELP = `asitis ${VERSION}: lint AI agent steering files (CLAUDE.md, AGENTS.md, SKILL.md, Cursor rules, ...).
Read-only: it never writes a file and makes no network calls.

Usage:
  asitis lint [paths...] [options]   lint the given files, or every steering file under the root
  asitis budget [file] [options]     tokens each agent loads at the start of every session
  asitis --version | --help

Options for lint:
  --root <dir>             the one folder asitis may read (default: the current folder)
  --format <f>             text (default), json, sarif or github
  --fail-on <level>        error (default), warning, note or never: lowest severity that exits 1
  --config <file>          config file inside the root (default: .asitisrc.json if present)
  --baseline <file>        hide findings whose fingerprint is listed in this file
  --write-baseline         print a baseline of the current findings (needs --format json)
  --include <list>         opt-in scans, comma-separated: skills, config, config-local
  --fix-preview[=safe]     attach suggested fixes; with text, print them as one unified diff
  --max-files <n>          most steering files to lint when walking the root (default and max 1,000)
  --max-file-mb <n>        largest file analysed, 1 to 64 (default 16)
  --quiet, -q              text and github: findings only, no summary or notices
  --annotate-notes         github: also annotate notes (by default only errors and warnings are)
  --allow-broad-root       allow your home folder or the filesystem root as --root
  --fail-on-hidden-security
                           exit 1 when .asitisrc.json or the baseline hides or lowers a security finding

Options for budget: --root, --format text|json, --max-file-mb, --allow-broad-root.

Exit codes: 0 no findings at or above --fail-on, 1 findings, 2 usage or input error, 3 internal error.
Docs: https://github.com/Katta041/asitis-agent-tools/blob/main/docs/cli-contract.md
`;

export const HELP_LINT = `asitis lint [paths...] [options]

Lints the files you name, or every steering file under the root (CLAUDE.md, AGENTS.md, SKILL.md,
Cursor rules, Copilot instructions, GEMINI.md, ...). Prints one line per finding, then a summary.

  --root <dir>             the one folder asitis may read (default: the current folder)
  --format <f>             text (default), json, sarif or github
  --fail-on <level>        error (default), warning, note or never: lowest severity that exits 1
  --config <file>          config file inside the root (default: .asitisrc.json if present)
  --baseline <file>        hide findings whose fingerprint is listed in this file
  --write-baseline         print a baseline of the current findings (needs --format json)
  --include <list>         opt-in scans, comma-separated: skills (scripts in skill folders),
                           config (.claude/settings.json and MCP config), config-local
  --fix-preview[=safe]     attach suggested fixes; with text, print them as one unified diff
  --max-files <n>          most steering files to lint when walking the root (default and max 1,000)
  --max-file-mb <n>        largest file analysed, 1 to 64 (default 16)
  --quiet, -q              text and github: findings only, no summary or notices
  --annotate-notes         github: also annotate notes (by default only errors and warnings are)
  --allow-broad-root       allow your home folder or the filesystem root as --root

Exit codes: 0 no findings at or above --fail-on, 1 findings, 2 usage or input error, 3 internal error.
`;

export const HELP_BUDGET = `asitis budget [file] [options]

Counts the tokens each agent (Claude Code, Codex, Gemini CLI, Cursor, Copilot) loads at the start of
every session, largest first. With a file, counts that file and what it imports. Counts are local
estimates. Exits 0 when the count ran, 2 on a usage or input error.

  --root <dir>             the one folder asitis may read (default: the current folder)
  --format <f>             text (default) or json
  --max-file-mb <n>        largest file analysed, 1 to 64 (default 16)
  --allow-broad-root       allow your home folder or the filesystem root as --root
`;

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
  nodeVersion: string;
  debug: boolean;
}

export function processIO(): CliIO {
  return {
    out: (t) => void process.stdout.write(t),
    err: (t) => void process.stderr.write(t),
    cwd: process.cwd(),
    nodeVersion: process.versions.node,
    debug: process.env["ASITIS_DEBUG"] === "1",
  };
}

/** The one-line error for a Node older than 22.13, or null. */
export function nodeVersionError(version: string): string | null {
  const v = version.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((v[i] ?? 0) > MIN_NODE[i]!) return null;
    if ((v[i] ?? 0) < MIN_NODE[i]!) return `Node 22.13 or later is needed (this is ${version.replace(/^v/, "")})`;
  }
  return null;
}

/** Absolute paths out of a message: they say where someone's files live and help nobody reading a CI log. */
export function scrubPaths(msg: string): string {
  return msg
    .replace(/(['"`])(?:[A-Za-z]:)?[\\/][^'"`\n]{0,1000}\1/g, "$1<path>$1")
    .replace(/(?:^|(?<=[\s(]))(?:[A-Za-z]:\\|\/)[^\s'"`)]{1,1000}/g, "<path>")
    .replace(/\s+/g, " ")
    .trim();
}

/** A UserError from shared code, reworded for a terminal: no absolute path, no MCP tool hints, no final period. */
function userLine(e: UserError): string {
  const m = e.message
    .replace(/ Paths are relative to (?:the allowed folder|that folder); find_steering_files lists the steering files\.?/, "")
    .replace(/ \(inside [^)]*\)/, "")
    .replace(/the allowed folder/g, "the root folder")
    .replace(/the server/g, "asitis")
    .replace(/this server/g, "asitis")
    .replace(/ Start the server with --root[^.]*\./, "");
  return scrubPaths(m).replace(/\.$/, "");
}

class Failure {
  constructor(readonly code: number, readonly line: string) {}
}

const usage = (line: string): Failure => new Failure(EXIT.usage, line);

/**
 * A path as the user gave it, or relative to the current folder when they gave an absolute one.
 * An absolute path outside the current folder is shown by its last part only ("hosts (absolute
 * path)"): "../../../../etc/hosts" reads oddly, and error lines never carry an absolute path.
 */
function relativeShown(given: string, io: CliIO): string {
  if (!path.isAbsolute(given)) return given;
  const rel = path.relative(io.cwd, given).split(path.sep).join("/") || ".";
  if (rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) return `${path.basename(given) || "/"} (absolute path)`;
  return rel;
}

function shown(p: string): string {
  return JSON.stringify(p).slice(1, -1) === p && !/\s/.test(p) ? p : JSON.stringify(p);
}

async function openSandbox(root: string | undefined, io: CliIO, opts: { allowBroadRoot: boolean; maxFileBytes: number | undefined }): Promise<{ sandbox: Sandbox; rootShown: string }> {
  const given = root ?? ".";
  const abs = path.resolve(io.cwd, given);
  const r = shown(relativeShown(given, io));
  try {
    const sandbox = await Sandbox.create([abs], { allowBroadRoot: opts.allowBroadRoot, ...(opts.maxFileBytes ? { maxFileBytes: opts.maxFileBytes } : {}) });
    return { sandbox, rootShown: given.replace(/\\/g, "/") };
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    const m = e.message;
    if (/not found/i.test(m)) throw usage(`--root ${r}: folder not found`);
    if (/not a folder/i.test(m)) throw usage(`--root ${r}: not a folder`);
    if (/home folder/.test(m)) throw usage("refusing to use your home folder as the root; pass your project with --root, or add --allow-broad-root");
    if (/filesystem root/.test(m)) throw usage("refusing to use the filesystem root as the root; pass your project with --root, or add --allow-broad-root");
    throw usage(`--root ${r}: ${userLine(e)}`);
  }
}

/**
 * Checks a path the user named: inside the root, exists, not a folder. Relative paths resolve
 * against the current folder, as in any CLI. Returns the path relative to the root.
 */
async function namedFile(sandbox: Sandbox, given: string, io: CliIO, flag = ""): Promise<string> {
  if (!given.trim()) throw usage(`${flag ? `${flag} got` : "got"} an empty path; pass a file inside the root${flag ? "" : ", or leave paths out to lint every steering file"}`);
  const abs = path.resolve(io.cwd, given);
  // An absolute path is shown relative to the current folder, so no error line carries one.
  const display = relativeShown(given, io);
  const label = flag ? `${flag} ${shown(display)}` : shown(display);
  const lex = sandbox.lexical(abs);
  if (!lex) throw usage(`${label}: outside the root folder; pass a path inside it, or change --root`);
  try {
    await sandbox.resolveReal(abs);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    if (/^File not found/.test(e.message)) throw usage(`${label}: file not found`);
    if (/symlink that resolves outside/.test(e.message)) throw usage(`${label}: a symlink that points outside the root folder`);
    throw usage(`${label}: ${userLine(e)}`);
  }
  if (await sandbox.listDir(abs).then(() => true, () => false)) throw usage(`${label}: a folder; pass files, or lint the folder with --root ${shown(display)}`);
  // Root-relative, so messages from shared code name the file the way the report does.
  return lex.rel || ".";
}

/** Agent config files the opt-in config scan reads, by lower-case name. */
const CONFIG_NAMES = new Set([".mcp.json", "mcp.json", "settings.json", "settings.local.json"]);

/** For a refused non-markdown file the opt-in scans would read, which flag reads it. */
function optInHint(p: string, include: readonly string[]): string {
  const base = path.posix.basename(p.replace(/\\/g, "/")).toLowerCase();
  if (CONFIG_NAMES.has(base) && !include.includes("config")) return `; to audit agent config files, run asitis lint --include config`;
  if (/\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|ps1|rb|pl)$/.test(base) && !include.includes("skills")) return `; to scan scripts in skill folders, run asitis lint --include skills`;
  return "";
}

function failsOn(f: Finding, failOn: FailOn): boolean {
  if (failOn === "never" || f.suppressed) return false;
  return SEVERITY_RANK[f.severity] <= SEVERITY_RANK[failOn];
}

async function lint(a: LintArgs, io: CliIO): Promise<number> {
  const { sandbox, rootShown } = await openSandbox(a.root, io, a);
  const targets: string[] = [];
  for (const p of a.paths) targets.push(await namedFile(sandbox, p, io));
  const configPath = a.configPath === undefined ? undefined : await namedFile(sandbox, a.configPath, io, "--config");
  const baselinePath = a.baselinePath === undefined ? undefined : await namedFile(sandbox, a.baselinePath, io, "--baseline");

  let project;
  try {
    project = await lintProject(sandbox, {
      targets,
      include: a.include,
      // The CLI honours include and extends from .asitisrc.json; the MCP server does not (cli-contract.md).
      configInclude: true,
      // The user runs the CLI on purpose in their own repo, so its config applies to security rules
      // too. Every security finding it hides is still counted in one line and kept in JSON and SARIF.
      trustRepoConfig: true,
      deadline: new Deadline(RUN_BUDGET_MS),
      maxFiles: a.maxFiles,
      ...(configPath === undefined ? {} : { configPath }),
      ...(baselinePath === undefined ? {} : { baselinePath }),
    });
  } catch (e) {
    // One named file that cannot be linted (a .mcp.json without --include config) fails the run.
    if (e instanceof UserError && targets.length === 1) throw usage(`${userLine(e)}${optInHint(targets[0]!, a.include)}`);
    throw e;
  }

  // A partial lint must never look like a clean one.
  if (project.timedOut) throw usage(`stopped at the ${RUN_BUDGET_MS / 60_000}-minute time limit; pass paths to lint fewer files`);
  if (project.unreadable.length) {
    const u = project.unreadable;
    throw usage(`could not read the folder ${shown(u[0]!)}${u.length > 1 ? ` and ${u.length - 1} more` : ""} (permission denied), so the steering files in it were not linted; fix the permissions, or add it to ignore in .asitisrc.json`);
  }
  const notes = [...project.notes];
  if (project.truncated) {
    // walkCutNote (project.ts) says which limit stopped the walk. The file, entry and time limits
    // leave files unlinted at random, so they exit 2. The depth limit is fixed and the same on
    // every run (big monorepos such as next.js and vscode always reach it), so it is a notice.
    const note = project.walkNote;
    const depthOnly = project.foundCount <= a.maxFiles && project.cut.depth && !project.cut.size && !project.cut.time;
    if (!depthOnly) {
      const why = project.foundCount > a.maxFiles ? `stopped after ${a.maxFiles.toLocaleString("en-US")} steering ${a.maxFiles === 1 ? "file" : "files"}` : note.replace(/\.$/, "").replace(/^\w/, (c) => c.toLowerCase());
      throw usage(`${why}; pass paths to lint the rest`);
    }
    notes.push(`${note.replace(/\.$/, "")}; pass their files as paths to lint them.`);
  }
  // A file the user named that could not be read is their mistake to fix. Files found by the walk
  // that could not be read are reported and skipped.
  if (!project.discovered && project.failures.length) {
    const f = project.failures[0]!;
    throw usage(`${shown(f.path)}: ${userLine(new UserError(f.error))}${optInHint(f.path, a.include)}`);
  }
  for (const f of project.failures) io.err(`asitis: ${shown(f.path)}: not linted (${userLine(new UserError(f.error))})\n`);

  const safety = a.fixPreview;
  if (safety && a.format !== "text" && a.format !== "github") attachFixes(project, safety);
  const findings = project.findings();
  const report = buildReport(rootShown, project.results.length, findings, project.hiddenSecurity);
  const hiddenSec = hiddenTotal(project.hiddenSecurity);
  const code = findings.some((f) => failsOn(f, a.failOn)) || (a.failOnHiddenSecurity && hiddenSec > 0) ? EXIT.findings : EXIT.ok;
  // The hidden-security line is shown in every format, --quiet included: hiding a security
  // finding is never silent.
  const alerts = project.hiddenNote ? [project.hiddenNote + (a.failOnHiddenSecurity ? " --fail-on-hidden-security is set, so this run fails." : "")] : [];

  if (a.writeBaseline) {
    io.out(`${JSON.stringify(baselineOf(findings.filter((f) => !f.suppressed)), null, 2)}\n`);
    return EXIT.ok;
  }

  switch (a.format) {
    case "text":
      if (safety) {
        const diff = fixPreview(project, safety);
        if (diff) io.out(diff.endsWith("\n") ? diff : `${diff}\n`);
        else if (!a.quiet) io.err("asitis: no fixes to suggest for these findings.\n");
        return code;
      }
      io.out(formatText(report, { quiet: a.quiet, notes, alerts }));
      break;
    case "json":
      io.out(formatJson(report));
      for (const n of [...alerts, ...notes]) io.err(`asitis: ${esc(n, 800)}\n`);
      break;
    case "sarif":
      io.out(formatSarif(report, { alerts }));
      for (const n of [...alerts, ...notes]) io.err(`asitis: ${esc(n, 800)}\n`);
      break;
    case "github":
      io.out(formatGithub(report, { quiet: a.quiet, notes, alerts, annotateNotes: a.annotateNotes }));
      break;
  }
  return code;
}

async function budget(a: BudgetArgs, io: CliIO): Promise<number> {
  const { sandbox, rootShown } = await openSandbox(a.root, io, a);
  const deadline = new Deadline(RUN_BUDGET_MS);
  if (a.path !== undefined) {
    const target = await namedFile(sandbox, a.path, io);
    const r = await fileBudgetReport(sandbox, target, deadline);
    io.out(a.format === "json" ? `${JSON.stringify(r.json, null, 2)}\n` : r.text);
    return EXIT.ok;
  }
  const r = await projectBudgetReport(sandbox, rootShown, deadline);
  if (deadline.expired) throw usage(`stopped at the ${RUN_BUDGET_MS / 60_000}-minute time limit; pass one file to count it`);
  io.out(a.format === "json" ? `${JSON.stringify(r.json, null, 2)}\n` : r.text);
  if (r.cut) io.err(`asitis: ${r.cut.replace(/\.$/, "")}; the totals above may be low\n`);
  return EXIT.ok;
}

/** Runs one command and returns the exit code. Never throws. */
export async function run(argv: string[], given?: CliIO): Promise<number> {
  let io: CliIO;
  try {
    io = given ?? processIO();
  } catch {
    // process.cwd() throws when the current folder was deleted or cannot be read.
    process.stderr.write("asitis: the current folder was deleted or cannot be read; cd into your project folder and run asitis again\n");
    return EXIT.usage;
  }
  const old = nodeVersionError(io.nodeVersion);
  if (old) {
    io.err(`asitis: ${old}\n`);
    return EXIT.usage;
  }
  try {
    const parsed = parse(argv);
    switch (parsed.command) {
      case "help":
        io.out(parsed.topic === "lint" ? HELP_LINT : parsed.topic === "budget" ? HELP_BUDGET : HELP);
        return EXIT.ok;
      case "version":
        io.out(`${VERSION}\n`);
        return EXIT.ok;
      case "budget":
        return await budget(parsed, io);
      case "lint":
        return await lint(parsed, io);
    }
  } catch (e) {
    if (e instanceof Failure) {
      io.err(`asitis: ${e.line}\n`);
      return e.code;
    }
    if (e instanceof UserError) {
      io.err(`asitis: ${userLine(e)}\n`);
      return EXIT.usage;
    }
    const msg = scrubPaths(e instanceof Error ? e.message : String(e)).replace(/\.$/, "") || "unknown error";
    io.err(`asitis: internal error in asitis ${VERSION}: ${msg}. Please report it at ${ISSUES_URL}\n`);
    if (io.debug && e instanceof Error && e.stack) io.err(`${e.stack}\n`);
    return EXIT.internal;
  }
}

/** Bundle entry: runs with the process arguments and sets the exit code once output is flushed. */
export async function main(): Promise<void> {
  // `asitis lint | head` closes stdout early; that is not an error worth a stack trace.
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(process.exitCode ?? 0);
  });
  process.exitCode = await run(process.argv.slice(2));
}
