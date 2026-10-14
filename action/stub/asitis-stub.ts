// STUB CLI FOR THE WP3 BRANCH ONLY. DELETE THIS FOLDER WHEN WP1 MERGES.
//
// The Action and the pre-commit hook run action/asitis.mjs, which WP1 owns and builds from
// packages/mcp/src/cli/asitis.ts. WP3 lands after WP1, so until then this file is bundled into
// action/asitis.mjs by action/stub/build-stub.mjs to give the Action something real to run.
// It follows docs/cli-contract.md closely enough for the self-test: the same flags the Action
// passes, exit codes 0 to 3, text, json, sarif and github output, built on lintProject and
// buildReport. It is not the CLI. On merge: delete action/stub/, run `npm run sync-plugin`
// from packages/mcp so WP1's bundle replaces action/asitis.mjs, and re-check the annotation
// counts in .github/workflows/action-selftest.yml.

import { Deadline } from "../../packages/mcp/src/discover.js";
import { esc } from "../../packages/mcp/src/escape.js";
import { buildReport, SEVERITY_RANK, type Finding, type FindingSeverity, type LintReport } from "../../packages/mcp/src/findings.js";
import { CAPS } from "../../packages/mcp/src/limits.js";
import { Sandbox, UserError } from "../../packages/mcp/src/paths.js";
import { INCLUDE_VALUES, lintProject, type Include } from "../../packages/mcp/src/project.js";
import { activeRules } from "../../packages/mcp/src/rules/registry.js";
import { VERSION } from "../../packages/mcp/src/version.js";

type Format = "text" | "json" | "sarif" | "github";
type FailOn = FindingSeverity | "never";

const out = (s: string): void => void process.stdout.write(s);
const err = (s: string): void => void process.stderr.write(`asitis: ${s.split("\n")[0]}\n`);

function nodeTooOld(): string | null {
  const [maj = 0, min = 0] = process.versions.node.split(".").map(Number);
  return maj > 22 || (maj === 22 && min >= 13) ? null : `Node 22.13 or later is needed (this is ${process.versions.node})`;
}

interface Opts {
  paths: string[];
  root: string;
  format: Format;
  failOn: FailOn;
  config?: string;
  baseline?: string;
  include: Include[];
  quiet: boolean;
}

function parse(argv: string[]): Opts {
  const o: Opts = { paths: [], root: ".", format: "text", failOn: "error", include: [], quiet: false };
  let rootSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      o.paths.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(0, eq) : a;
    const value = (): string => {
      if (eq > 0) return a.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined) throw new UserError(`${name} needs a value`);
      return v;
    };
    switch (name) {
      case "--root":
        if (rootSeen) throw new UserError("only one --root is allowed");
        rootSeen = true;
        o.root = value();
        break;
      case "--format": {
        const v = value();
        if (!["text", "json", "sarif", "github"].includes(v)) throw new UserError(`--format must be text, json, sarif or github, not "${v}"`);
        o.format = v as Format;
        break;
      }
      case "--fail-on": {
        const v = value();
        if (!["error", "warning", "note", "never"].includes(v)) throw new UserError(`--fail-on must be error, warning, note or never, not "${v}"`);
        o.failOn = v as FailOn;
        break;
      }
      case "--config":
        o.config = value();
        break;
      case "--baseline":
        o.baseline = value();
        break;
      case "--include":
        for (const v of value().split(",").map((s) => s.trim()).filter(Boolean)) {
          if (!INCLUDE_VALUES.includes(v as Include)) throw new UserError(`--include values are ${INCLUDE_VALUES.join(", ")}, not "${v}"`);
          o.include.push(v as Include);
        }
        break;
      case "--quiet":
        o.quiet = true;
        break;
      default:
        throw new UserError(`unknown flag ${name}`);
    }
  }
  return o;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

function summaryLine(r: LintReport): string {
  const s = r.summary;
  const parts = [s.errors && plural(s.errors, "error"), s.warnings && plural(s.warnings, "warning"), s.notes && plural(s.notes, "note")].filter(Boolean);
  const body = parts.length ? parts.join(", ") : "no issues found";
  return `Linted ${plural(s.files, "file")}: ${body}${s.suppressed ? `, ${s.suppressed} suppressed` : ""}.`;
}

const live = (r: LintReport): Finding[] => r.findings.filter((f) => !f.suppressed);

function formatText(r: LintReport, notes: string[], quiet: boolean): string {
  const lines = live(r).map((f) => `${esc(f.path, 400)}:${f.line}:${f.column} ${f.severity} ${f.ruleId} ${esc(f.message, 2000)}`);
  if (!quiet) lines.push("", summaryLine(r), ...notes.map((n) => esc(n, 400)));
  return lines.length ? `${lines.join("\n")}\n` : "";
}

const ghData = (s: string): string => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const ghProp = (s: string): string => ghData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
const GH_CMD: Record<FindingSeverity, string> = { error: "error", warning: "warning", note: "notice" };

function formatGithub(r: LintReport, notes: string[], quiet: boolean): string {
  const lines = live(r).map(
    (f) =>
      `::${GH_CMD[f.severity]} file=${ghProp(f.path)},line=${f.line},col=${f.column},endLine=${f.endLine},endColumn=${f.endColumn},title=${ghProp(`asitis(${f.ruleId})`)}::${ghData(f.message)}`,
  );
  if (!quiet) {
    lines.push(`asitis: ${summaryLine(r)}`);
    for (const n of notes) lines.push(`::notice::${ghData(n)}`);
  }
  return `${lines.join("\n")}\n`;
}

const SEC_SEVERITY: Record<FindingSeverity, string> = { error: "8.0", warning: "5.0", note: "2.0" };
const TAGS: Record<string, string[]> = { security: ["security"], format: ["steering"], budget: ["budget"], drift: ["drift"], config: ["steering"] };
const uri = (p: string): string => p.split("/").map(encodeURIComponent).join("/");

function formatSarif(r: LintReport): string {
  const rules = activeRules();
  const index = new Map(rules.map((x, i) => [x.id, i]));
  const log = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "AsItIs",
            version: VERSION,
            informationUri: "https://asitis.app",
            rules: rules.map((x) => ({
              id: x.id,
              shortDescription: { text: x.summary },
              fullDescription: { text: x.why },
              helpUri: `https://asitis.app/rules/${x.id}`,
              defaultConfiguration: { level: x.defaultSeverity },
              properties: { tags: TAGS[x.category] ?? ["steering"], ...(x.category === "security" ? { "security-severity": SEC_SEVERITY[x.defaultSeverity] } : {}) },
            })),
          },
        },
        columnKind: "utf16CodeUnits",
        invocations: [{ executionSuccessful: true }],
        results: r.findings.map((f) => ({
          ruleId: f.ruleId,
          ...(index.has(f.ruleId) ? { ruleIndex: index.get(f.ruleId) } : {}),
          level: f.severity,
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: uri(f.path), uriBaseId: "%SRCROOT%" },
                region: { startLine: f.line, startColumn: f.column, endLine: f.endLine, endColumn: f.endColumn },
              },
            },
          ],
          partialFingerprints: { "asitis/v1": f.fingerprint },
          ...(f.suppressed ? { suppressions: [f.suppressed] } : {}),
        })),
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}

async function lint(argv: string[]): Promise<number> {
  const o = parse(argv);
  const sandbox = await Sandbox.create([o.root]);
  const project = await lintProject(sandbox, {
    targets: o.paths,
    include: o.include,
    deadline: new Deadline(300_000),
    maxFiles: CAPS.walkMaxFiles,
    ...(o.config === undefined ? {} : { configPath: o.config }),
    ...(o.baseline === undefined ? {} : { baselinePath: o.baseline }),
  });
  if (project.timedOut || project.truncated) throw new UserError(`stopped after ${CAPS.walkMaxFiles.toLocaleString("en-US")} steering files; pass paths to lint the rest`);
  if (!project.discovered && project.failures.length) throw new UserError(`${project.failures[0]!.path}: ${project.failures[0]!.error}`);
  for (const f of project.failures) err(`${f.path}: not linted (${f.error})`);
  const report = buildReport(o.root.replace(/\\/g, "/"), project.results.length, project.findings());
  if (o.format === "json") out(`${JSON.stringify(report, null, 2)}\n`);
  else if (o.format === "sarif") out(formatSarif(report));
  else if (o.format === "github") out(formatGithub(report, project.notes, o.quiet));
  else out(formatText(report, project.notes, o.quiet));
  if (o.format === "json" || o.format === "sarif") for (const n of project.notes) err(n);
  if (o.failOn === "never") return 0;
  const limit = SEVERITY_RANK[o.failOn];
  return live(report).some((f) => SEVERITY_RANK[f.severity] <= limit) ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  try {
    const old = nodeTooOld();
    if (old) throw new UserError(old);
    if (argv[0] === "--version") {
      out(`asitis ${VERSION}\n`);
      return 0;
    }
    if (argv[0] === "--help" || argv.length === 0) {
      out("Usage: asitis lint [paths...] [--root <dir>] [--format text|json|sarif|github] [--fail-on error|warning|note|never]\n");
      return argv.length === 0 ? 2 : 0;
    }
    if (argv[0] !== "lint") throw new UserError(`unknown command "${argv[0]}"; try asitis lint`);
    return await lint(argv.slice(1));
  } catch (e) {
    if (e instanceof UserError) {
      err(e.message);
      return 2;
    }
    const msg = (e instanceof Error ? e.message : String(e)).replace(/(?:[A-Za-z]:)?[\\/][^\s"']+/g, "<path>");
    err(`internal error in asitis ${VERSION} (stub CLI): ${msg}. Please report it at https://github.com/Katta041/asitis-agent-tools/issues`);
    if (process.env["ASITIS_DEBUG"] === "1" && e instanceof Error && e.stack) process.stderr.write(`${e.stack}\n`);
    return 3;
  }
}

process.exitCode = await main(process.argv.slice(2));
