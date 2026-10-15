// Argument parsing for the asitis CLI. Owner: WP1. Every mistake here is a UserError, which the
// entry point prints as one "asitis: ..." line with exit code 2 (docs/cli-contract.md).

import { parseArgs } from "node:util";
import { CAPS } from "../limits.js";
import type { FindingSeverity } from "../findings.js";
import { UserError } from "../paths.js";
import { INCLUDE_VALUES, type Include } from "../project.js";

export type Format = "text" | "json" | "sarif" | "github";
export type FailOn = FindingSeverity | "never";

export const FORMATS: readonly Format[] = ["text", "json", "sarif", "github"];
export const FAIL_ON: readonly FailOn[] = ["error", "warning", "note", "never"];

export interface LintArgs {
  command: "lint";
  paths: string[];
  root: string | undefined;
  format: Format;
  failOn: FailOn;
  configPath: string | undefined;
  baselinePath: string | undefined;
  writeBaseline: boolean;
  include: Include[];
  fixPreview: "safe" | "all" | undefined;
  maxFileBytes: number | undefined;
  maxFiles: number;
  quiet: boolean;
  annotateNotes: boolean;
  allowBroadRoot: boolean;
}

export interface BudgetArgs {
  command: "budget";
  path: string | undefined;
  root: string | undefined;
  format: "text" | "json";
  maxFileBytes: number | undefined;
  allowBroadRoot: boolean;
}

export type Parsed = LintArgs | BudgetArgs | { command: "help"; topic?: "lint" | "budget" } | { command: "version" };

/** "error, warning, note or never". */
const orList = (xs: readonly string[]): string => `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

/** Quotes a value from the command line for an error line, escaped so it stays one line. */
const shown = (v: string): string => JSON.stringify(v.length > 60 ? `${v.slice(0, 60)}...` : v);

function pick<T extends string>(flag: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UserError(`${flag} must be ${orList(allowed)}, not ${shown(value)}`);
}

function maxFileMb(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const mb = Number(value);
  if (!/^\d+(\.\d+)?$/.test(value.trim()) || !Number.isFinite(mb) || mb < 1 || mb > 64) throw new UserError(`--max-file-mb must be a number from 1 to 64, not ${shown(value)}`);
  return Math.floor(mb * 1024 * 1024);
}

function maxFiles(value: string | undefined): number {
  if (value === undefined) return CAPS.walkMaxFiles;
  const k = Number(value);
  if (!/^\d+$/.test(value.trim()) || k < 1 || k > CAPS.walkMaxFiles) throw new UserError(`--max-files must be a whole number from 1 to ${CAPS.walkMaxFiles.toLocaleString("en-US")}, not ${shown(value)}`);
  return k;
}

function includeList(values: string[] | undefined): Include[] {
  const out: Include[] = [];
  for (const v of (values ?? []).flatMap((x) => x.split(","))) {
    const t = v.trim();
    if (!t) continue;
    if (!(INCLUDE_VALUES as readonly string[]).includes(t)) throw new UserError(`--include takes ${orList(INCLUDE_VALUES)}, not ${shown(t)}`);
    if (!out.includes(t as Include)) out.push(t as Include);
  }
  return out;
}

/** --fix-preview takes an optional value, which parseArgs cannot express: rewrite the bare flag. */
function normalise(argv: string[]): string[] {
  return argv.map((a) => (a === "--fix-preview" ? "--fix-preview=all" : a));
}

function single(flag: string, values: string[] | undefined): string | undefined {
  if (!values?.length) return undefined;
  if (values.length > 1) throw new UserError(`${flag} can be given only once`);
  return values[0];
}

/** Node's parseArgs messages, cut to one plain line. */
function parseError(e: unknown): UserError {
  const msg = ((e as Error).message ?? "").split("\n")[0]!.split(". To specify")[0]!.replace(/\.$/, "");
  const unknown = /^Unknown option '([^']+)'/.exec(msg);
  if (unknown) return new UserError(`unknown option ${unknown[1]}; run asitis --help for the options`);
  const missing = /^Option '(?:-\w, )?(--[a-z-]+)[^']*' argument missing/.exec(msg);
  if (missing) return new UserError(`${missing[1]} needs a value`);
  const ambiguous = /^Option '(?:-\w, )?(--[a-z-]+)[^']*' argument is ambiguous/.exec(msg);
  if (ambiguous) return new UserError(`${ambiguous[1]} needs a value; to pass a value that starts with "-", write ${ambiguous[1]}=<value>`);
  const unexpected = /^Unexpected argument '([^']*)'/.exec(msg);
  if (unexpected) return new UserError(`unexpected argument ${shown(unexpected[1]!)}`);
  const noValue = /^Option '(?:-\w, )?(--[a-z-]+)' does not take an argument/.exec(msg);
  if (noValue) return new UserError(`${noValue[1]} does not take a value`);
  return new UserError(`${msg}; run asitis --help for usage`);
}

export function parse(argv: string[]): Parsed {
  let parsed;
  try {
    parsed = parseArgs({
      args: normalise(argv),
      allowPositionals: true,
      strict: true,
      options: {
        root: { type: "string", multiple: true },
        format: { type: "string", multiple: true },
        "fail-on": { type: "string", multiple: true },
        config: { type: "string", multiple: true },
        baseline: { type: "string", multiple: true },
        "write-baseline": { type: "boolean" },
        include: { type: "string", multiple: true },
        "fix-preview": { type: "string", multiple: true },
        "max-file-mb": { type: "string", multiple: true },
        "max-files": { type: "string", multiple: true },
        quiet: { type: "boolean", short: "q" },
        "annotate-notes": { type: "boolean" },
        "allow-broad-root": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    throw parseError(e);
  }
  const { values: v, positionals } = parsed;
  if (v.help) {
    const topic = positionals[0];
    return topic === "lint" || topic === "budget" ? { command: "help", topic } : { command: "help" };
  }
  if (v.version) return { command: "version" };
  const [command, ...rest] = positionals;
  if (command === undefined) throw new UserError("no command given; run asitis lint, asitis budget or asitis --help");

  const root = single("--root", v.root);
  const maxFileBytes = maxFileMb(single("--max-file-mb", v["max-file-mb"]));
  const allowBroadRoot = !!v["allow-broad-root"];

  if (command === "budget") {
    for (const [flag, given] of [
      ["--fail-on", v["fail-on"]],
      ["--config", v.config],
      ["--baseline", v.baseline],
      ["--include", v.include],
      ["--fix-preview", v["fix-preview"]],
      ["--max-files", v["max-files"]],
    ] as const) {
      if (given?.length) throw new UserError(`${flag} only applies to asitis lint`);
    }
    if (v["write-baseline"]) throw new UserError("--write-baseline only applies to asitis lint");
    if (v.quiet) throw new UserError("--quiet only applies to asitis lint");
    if (v["annotate-notes"]) throw new UserError("--annotate-notes only applies to asitis lint");
    if (rest.length > 1) throw new UserError("asitis budget takes at most one file; leave it out for the whole folder");
    return {
      command: "budget",
      path: rest[0],
      root,
      format: pick("--format", single("--format", v.format), ["text", "json"] as const, "text"),
      maxFileBytes,
      allowBroadRoot,
    };
  }
  if (command !== "lint") throw new UserError(`unknown command ${shown(command)}; the commands are lint and budget`);

  const format = pick("--format", single("--format", v.format), FORMATS, "text");
  const writeBaseline = !!v["write-baseline"];
  if (writeBaseline && format !== "json") throw new UserError("--write-baseline needs --format json");
  if (v["annotate-notes"] && format !== "github") throw new UserError("--annotate-notes only applies to --format github");
  const fp = single("--fix-preview", v["fix-preview"]);
  if (fp !== undefined && fp !== "all" && fp !== "safe") throw new UserError(`--fix-preview takes no value or =safe, not ${shown(fp)}`);
  return {
    command: "lint",
    paths: rest,
    root,
    format,
    failOn: pick("--fail-on", single("--fail-on", v["fail-on"]), FAIL_ON, "error"),
    configPath: single("--config", v.config),
    baselinePath: single("--baseline", v.baseline),
    writeBaseline,
    include: includeList(v.include),
    fixPreview: fp as "safe" | "all" | undefined,
    maxFileBytes,
    maxFiles: maxFiles(single("--max-files", v["max-files"])),
    quiet: !!v.quiet,
    annotateNotes: !!v["annotate-notes"],
    allowBroadRoot,
  };
}
