// .asitisrc.json: loading, validation and applying it to findings. Owner: WP2.
// docs/cli-contract.md ("Config", "Suppression") is the spec. Summary:
// - loadConfig reads <root>/.asitisrc.json, or configPath, through sandbox.openAs("asitisrc", ...).
//   A missing default file is fine (null). A missing --config file, invalid JSON, an unknown key,
//   rule id or severity, or a bad option throws UserError with the file, line and a "did you mean"
//   hint. The CLI turns that into exit code 2; lint_steering shows it as the tool error.
// - applyConfig runs once, after every check, for the CLI and lint_steering alike: ignore globs,
//   thresholds, asitis-disable comments (suppress.ts), rule severity and "off" (preset, then rules,
//   then each matching override in order), and last the baseline.
// - A rule that is "off" is removed. Suppressed findings stay, marked, so every summary counts them.
// - Security rules are never turned off by a comment. The repo's config and baseline apply to them
//   only with trust (the CLI, or lint_steering with trustRepoConfig), and even then each hidden
//   security finding stays in JSON and SARIF as suppressed and is counted in one summary line.
//
// Why it is validated strictly: in agnix issue 1152 (read 14 October 2026,
// https://github.com/agent-sh/agnix/issues/1152) one misspelled key made agnix drop the whole
// config and fall back to defaults, with only a warning. Here every mistake stops the run and
// names the line.

import type { Doc } from "./doc.js";
import { q } from "./escape.js";
import { INCLUDE_VALUES, findingPath, fingerprint, fingerprintTextOf, normaliseLineText, type FindingSource, type Include, type LineText } from "./findings.js";
import { VENDOR } from "./limits.js";
import type { Issue, LintResult, Severity } from "./lint.js";
import { UserError, type Sandbox } from "./paths.js";
import { CONFIG_FILE, CONFIG_MAX_BYTES } from "./policy/asitisrc.js";
import { findSecrets, redactValue } from "./redact.js";
import { activeRules, getRule } from "./rules/registry.js";
import { applyInlineSuppressions, parseSuppressions } from "./suppress.js";
import { loadBaseline } from "./baseline.js";

export type ConfigSeverity = "error" | "warning" | "note" | "off";
export const CONFIG_SEVERITIES: readonly ConfigSeverity[] = ["error", "warning", "note", "off"];
export type Preset = "recommended" | "strict";

/** Thresholds for the length rule. Defaults (and their sources) stay in limits.ts. */
export interface LengthOptions {
  claudeMdLines?: number;
  skillMdLines?: number;
  cursorRuleLines?: number;
  codexBytes?: number;
  windsurfChars?: number;
  memoryIndexLines?: number;
}
export const LENGTH_OPTIONS: ReadonlyArray<keyof LengthOptions> = ["claudeMdLines", "skillMdLines", "cursorRuleLines", "codexBytes", "windsurfChars", "memoryIndexLines"];

export interface RuleSetting {
  severity: ConfigSeverity;
  options?: LengthOptions;
}

export interface Override {
  files: string[];
  rules: Record<string, RuleSetting>;
}

export interface LoadedConfig {
  /** Root-relative path of the file read. */
  path: string;
  include?: Include[];
  extends: Preset;
  rules: Record<string, RuleSetting>;
  ignore: string[];
  overrides: Override[];
}

export interface ConfigRun {
  sandbox: Sandbox;
  results: LintResult[];
  /** Parallel to the first docs.length entries of results. Ignored files are removed from both. */
  docs: Doc[];
  include: ReadonlySet<Include>;
  baselinePath?: string;
  /**
   * Apply the repo's .asitisrc.json and baseline to security rules too. The CLI sets it (the user
   * runs it on purpose); lint_steering sets it only when the call passes trustRepoConfig.
   */
  trustRepoConfig?: boolean;
  /** Line text for result files that are not linted markdown (scripts, JSON configs), for fingerprints. */
  lineTexts?: ReadonlyMap<string, LineText>;
}

// ---------------------------------------------------------------------------------------------
// JSON with line numbers. JSON.parse gives no positions, and every error here must name a line.
// One forward pass, nesting capped, so a 64 KB file of brackets finishes at once.

export type JsonNode =
  | { type: "object"; line: number; entries: Array<{ key: string; line: number; value: JsonNode }> }
  | { type: "array"; line: number; items: JsonNode[] }
  | { type: "string"; line: number; value: string }
  | { type: "number"; line: number; value: number }
  | { type: "boolean"; line: number; value: boolean }
  | { type: "null"; line: number };

const MAX_DEPTH = 32;

/** Parses JSON and keeps the line of every value and key. Throws UserError("<file> line N: ..."). */
export function parseJsonLines(text: string, file: string): JsonNode {
  let i = 0;
  let line = 1;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const fail = (what: string, at = line): never => {
    throw new UserError(`${file} line ${at}: ${what}`);
  };
  const ws = (): void => {
    for (; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 10) line++;
      else if (c !== 32 && c !== 9 && c !== 13) break;
    }
  };
  const found = (): string => (i >= s.length ? "the end of the file" : JSON.stringify(s.slice(i, i + 1)));
  const str = (): string => {
    const start = ++i;
    let out = "";
    let from = start;
    for (; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 34) {
        out += s.slice(from, i);
        i++;
        return out;
      }
      if (c === 10 || c < 32) fail("invalid JSON: a string is not closed on its line");
      if (c === 92) {
        out += s.slice(from, i);
        const e = s[i + 1];
        const map: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (e === "u") {
          const hex = s.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid JSON: bad \\u escape in a string");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
        } else if (e !== undefined && map[e] !== undefined) {
          out += map[e];
          i += 1;
        } else fail("invalid JSON: bad escape in a string");
        from = i + 1;
      }
    }
    return fail("invalid JSON: a string is not closed");
  };
  const value = (depth: number): JsonNode => {
    ws();
    if (depth > MAX_DEPTH) fail(`nesting is deeper than ${MAX_DEPTH} levels`);
    const at = line;
    const c = s[i];
    if (c === "{") {
      i++;
      const entries: Array<{ key: string; line: number; value: JsonNode }> = [];
      const seen = new Set<string>();
      ws();
      if (s[i] === "}") {
        i++;
        return { type: "object", line: at, entries };
      }
      for (;;) {
        ws();
        if (s[i] !== '"') fail(`invalid JSON: expected a key in double quotes, found ${found()}`);
        const keyLine = line;
        const key = str();
        if (seen.has(key)) fail(`key ${quoteKey(key)} appears twice; keep one`, keyLine);
        seen.add(key);
        ws();
        if (s[i] !== ":") fail(`invalid JSON: expected ":" after ${quoteKey(key)}, found ${found()}`);
        i++;
        entries.push({ key, line: keyLine, value: value(depth + 1) });
        ws();
        if (s[i] === ",") {
          i++;
          ws();
          if (s[i] === "}") fail("invalid JSON: trailing comma before }");
          continue;
        }
        if (s[i] === "}") {
          i++;
          return { type: "object", line: at, entries };
        }
        fail(`invalid JSON: expected "," or "}", found ${found()}`);
      }
    }
    if (c === "[") {
      i++;
      const items: JsonNode[] = [];
      ws();
      if (s[i] === "]") {
        i++;
        return { type: "array", line: at, items };
      }
      for (;;) {
        items.push(value(depth + 1));
        ws();
        if (s[i] === ",") {
          i++;
          ws();
          if (s[i] === "]") fail("invalid JSON: trailing comma before ]");
          continue;
        }
        if (s[i] === "]") {
          i++;
          return { type: "array", line: at, items };
        }
        fail(`invalid JSON: expected "," or "]", found ${found()}`);
      }
    }
    if (c === '"') return { type: "string", line: at, value: str() };
    const lit = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(s.slice(i, i + 40));
    if (lit) {
      i += lit[0].length;
      const t = lit[0];
      if (t === "true" || t === "false") return { type: "boolean", line: at, value: t === "true" };
      if (t === "null") return { type: "null", line: at };
      return { type: "number", line: at, value: Number(t) };
    }
    if (c === "/") fail("invalid JSON: comments are not allowed in JSON");
    return fail(`invalid JSON: expected a value, found ${found()}`);
  };
  ws();
  if (i >= s.length) fail("the file is empty; it must hold a JSON object");
  const root = value(0);
  ws();
  if (i < s.length) fail(`invalid JSON: unexpected ${found()} after the end of the value`);
  return root;
}

const quoteKey = (k: string): string => q(k, 60);

/** A config value for a message: short plain values (a word, a number, a glob) as they are, anything else redacted. */
export function showValue(n: JsonNode): string {
  // A word, or a short value with digits ("300"), is shown so the user sees the typo. Anything longer
  // with digits could be a password pasted into the wrong file, so only its length is shown.
  if (n.type === "string") return (/^[A-Za-z ._*?/-]{1,24}$/.test(n.value) || /^[A-Za-z0-9 ._*?/-]{1,7}$/.test(n.value)) && !findSecrets(n.value).length ? JSON.stringify(n.value) : `"${redactValue(n.value)}"`;
  if (n.type === "number" || n.type === "boolean") return String(n.value);
  return n.type === "null" ? "null" : `an ${n.type}`.replace("an array", "a list");
}

// ---------------------------------------------------------------------------------------------
// "did you mean"

/** Edit distance capped at max + 1, linear in memory. Inputs are short keys and rule ids. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let x = 1; x <= a.length; x++) {
    const cur = [x];
    let best = x;
    for (let y = 1; y <= b.length; y++) {
      const v = Math.min(prev[y]! + 1, cur[y - 1]! + 1, prev[y - 1]! + (a[x - 1] === b[y - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** The closest candidate within a third of the word's length (at least 1, at most 3 edits), or null. */
export function didYouMean(word: string, candidates: readonly string[]): string | null {
  if (word.length > 80) return null;
  const w = word.toLowerCase();
  const max = Math.min(3, Math.max(1, Math.floor(w.length / 3)));
  let best: string | null = null;
  let bestD = max + 1;
  for (const c of candidates) {
    const d = c.toLowerCase().startsWith(w) && w.length >= 4 ? 1 : distance(w, c.toLowerCase(), max);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const hint = (word: string, candidates: readonly string[]): string => {
  const m = didYouMean(word, candidates);
  return m ? ` (did you mean ${JSON.stringify(m)}?)` : "";
};

// ---------------------------------------------------------------------------------------------
// Validation

const TOP_KEYS = ["$schema", "extends", "rules", "ignore", "overrides", "include"] as const;
const OVERRIDE_KEYS = ["files", "rules"] as const;
const PRESETS: readonly Preset[] = ["recommended", "strict"];
const MAX_GLOBS = 200;
const MAX_GLOB_CHARS = 500;
const MAX_OVERRIDES = 100;
/** Largest threshold accepted: far beyond any steering file, small enough to catch a typo of extra zeros. */
const MAX_THRESHOLD = 100_000_000;

/** Rule ids that config and comments may name: active rules only. */
export const configurableRuleIds = (): string[] => activeRules().map((r) => r.id);

function ruleId(id: string, line: number, file: string, where: string): string {
  const r = getRule(id);
  if (r && r.status === "active") return id;
  const why = r ? "is not available in this version of asitis" : "is not an asitis rule";
  throw new UserError(`${file} line ${line}: ${where}${quoteKey(id)} ${why}${hint(id, configurableRuleIds())}`);
}

function severityOf(n: JsonNode, file: string, at: string): ConfigSeverity {
  if (n.type === "string" && (CONFIG_SEVERITIES as readonly string[]).includes(n.value)) return n.value as ConfigSeverity;
  const near = n.type === "string" ? hint(n.value, CONFIG_SEVERITIES) : "";
  throw new UserError(`${file} line ${n.line}: ${at} must be "error", "warning", "note" or "off", not ${showValue(n)}${near}`);
}

function parseRules(n: JsonNode, file: string, at: string): Record<string, RuleSetting> {
  if (n.type !== "object") throw new UserError(`${file} line ${n.line}: ${at} must be an object of rule ids, not ${showValue(n)}`);
  const out: Record<string, RuleSetting> = {};
  for (const e of n.entries) {
    const id = ruleId(e.key, e.line, file, `${at}: `);
    const v = e.value;
    if (v.type === "string") {
      out[id] = { severity: severityOf(v, file, `${at}.${id}`) };
      continue;
    }
    if (v.type !== "array" || v.items.length < 1 || v.items.length > 2) {
      throw new UserError(`${file} line ${v.line}: ${at}.${id} must be a severity ("error", "warning", "note" or "off") or [severity, options], not ${showValue(v)}`);
    }
    const setting: RuleSetting = { severity: severityOf(v.items[0]!, file, `${at}.${id}[0]`) };
    const opts = v.items[1];
    if (opts) {
      if (id !== "length") throw new UserError(`${file} line ${opts.line}: ${at}.${id} takes no options; only "length" has options (${LENGTH_OPTIONS.join(", ")})`);
      setting.options = parseLengthOptions(opts, file, `${at}.${id}[1]`);
    }
    out[id] = setting;
  }
  return out;
}

function parseLengthOptions(n: JsonNode, file: string, at: string): LengthOptions {
  if (n.type !== "object") throw new UserError(`${file} line ${n.line}: ${at} must be an object such as {"claudeMdLines": 300}, not ${showValue(n)}`);
  const out: LengthOptions = {};
  for (const e of n.entries) {
    if (!(LENGTH_OPTIONS as readonly string[]).includes(e.key)) {
      throw new UserError(`${file} line ${e.line}: unknown option ${quoteKey(e.key)} for length${hint(e.key, LENGTH_OPTIONS)}`);
    }
    const v = e.value;
    if (v.type !== "number" || !Number.isInteger(v.value) || v.value < 1 || v.value > MAX_THRESHOLD) {
      throw new UserError(`${file} line ${v.line}: ${at}.${e.key} must be a whole number from 1 to ${MAX_THRESHOLD.toLocaleString("en-US")}, not ${showValue(v)}`);
    }
    out[e.key as keyof LengthOptions] = v.value;
  }
  return out;
}

function parseGlobs(n: JsonNode, file: string, at: string): string[] {
  const items = n.type === "array" ? n.items : null;
  if (!items) throw new UserError(`${file} line ${n.line}: ${at} must be a list of glob patterns such as ["vendor/**"], not ${showValue(n)}`);
  if (items.length > MAX_GLOBS) throw new UserError(`${file} line ${n.line}: ${at} has more than ${MAX_GLOBS} patterns`);
  return items.map((g, k) => {
    if (g.type !== "string" || !g.value.trim()) throw new UserError(`${file} line ${g.line}: ${at}[${k}] must be a non-empty glob pattern string, not ${showValue(g)}`);
    if (g.value.length > MAX_GLOB_CHARS) throw new UserError(`${file} line ${g.line}: ${at}[${k}] is longer than ${MAX_GLOB_CHARS} characters`);
    if (g.value.startsWith("!")) throw new UserError(`${file} line ${g.line}: ${at}[${k}] starts with "!"; negated patterns are not supported, list the files to match instead`);
    if (g.value.includes("\\")) throw new UserError(`${file} line ${g.line}: ${at}[${k}] contains a backslash; write paths with forward slashes, relative to the project folder`);
    if (/(^|\/)\.\.(\/|$)/.test(g.value)) throw new UserError(`${file} line ${g.line}: ${at}[${k}] points outside the project folder`);
    return g.value;
  });
}

/** Validates parsed .asitisrc.json. Exported for tests; loadConfig is the normal way in. */
export function validateConfig(root: JsonNode, file: string): LoadedConfig {
  if (root.type !== "object") throw new UserError(`${file} line ${root.line}: the config must be a JSON object, not ${showValue(root)}`);
  const cfg: LoadedConfig = { path: file, extends: "recommended", rules: {}, ignore: [], overrides: [] };
  for (const e of root.entries) {
    const v = e.value;
    switch (e.key) {
      case "$schema":
        if (v.type !== "string") throw new UserError(`${file} line ${v.line}: $schema must be a string`);
        break;
      case "extends":
        if (v.type !== "string" || !(PRESETS as readonly string[]).includes(v.value)) {
          throw new UserError(`${file} line ${v.line}: extends must be "recommended" or "strict", not ${showValue(v)}${v.type === "string" ? hint(v.value, PRESETS) : ""}`);
        }
        cfg.extends = v.value as Preset;
        break;
      case "rules":
        cfg.rules = parseRules(v, file, "rules");
        break;
      case "ignore":
        cfg.ignore = parseGlobs(v, file, "ignore");
        break;
      case "include": {
        if (v.type !== "array") throw new UserError(`${file} line ${v.line}: include must be a list such as ["skills", "config"], not ${showValue(v)}`);
        const inc: Include[] = [];
        for (const it of v.items) {
          if (it.type !== "string" || !(INCLUDE_VALUES as readonly string[]).includes(it.value)) {
            throw new UserError(`${file} line ${it.line}: include values are "skills", "config" and "config-local", not ${showValue(it)}${it.type === "string" ? hint(it.value, INCLUDE_VALUES) : ""}`);
          }
          if (!inc.includes(it.value as Include)) inc.push(it.value as Include);
        }
        cfg.include = inc;
        break;
      }
      case "overrides": {
        if (v.type !== "array") throw new UserError(`${file} line ${v.line}: overrides must be a list of {"files": [...], "rules": {...}} objects, not ${showValue(v)}`);
        if (v.items.length > MAX_OVERRIDES) throw new UserError(`${file} line ${v.line}: overrides has more than ${MAX_OVERRIDES} entries`);
        v.items.forEach((o, k) => {
          const at = `overrides[${k}]`;
          if (o.type !== "object") throw new UserError(`${file} line ${o.line}: ${at} must be an object with "files" and "rules", not ${showValue(o)}`);
          let files: string[] | null = null;
          let rules: Record<string, RuleSetting> = {};
          for (const oe of o.entries) {
            if (oe.key === "files") files = parseGlobs(oe.value, file, `${at}.files`);
            else if (oe.key === "rules") rules = parseRules(oe.value, file, `${at}.rules`);
            else throw new UserError(`${file} line ${oe.line}: unknown key ${quoteKey(oe.key)} in ${at}${hint(oe.key, OVERRIDE_KEYS)}`);
          }
          if (!files || !files.length) throw new UserError(`${file} line ${o.line}: ${at} needs "files", a list of glob patterns`);
          cfg.overrides.push({ files, rules });
        });
        break;
      }
      default:
        throw new UserError(`${file} line ${e.line}: unknown key ${quoteKey(e.key)}${hint(e.key, TOP_KEYS)}`);
    }
  }
  // strict turns the sec-* rules on: they live in the skills and config scans, which are opt-in.
  // Only the CLI honours this (lintProject configInclude); lint_steering takes include from the call.
  if (cfg.extends === "strict") cfg.include = [...new Set<Include>([...(cfg.include ?? []), "skills", "config"])];
  return cfg;
}

// ---------------------------------------------------------------------------------------------
// Loading

/** The root-relative POSIX path of p if it is inside the first root, else a UserError. */
function insidePrimary(sandbox: Sandbox, p: string, what: string): string {
  const lex = sandbox.lexical(p);
  if (!lex || lex.root !== sandbox.primary) throw new UserError(`Refused: ${what} ${p} is outside the project folder ${sandbox.primary.given}; it must be inside it.`);
  return lex.rel;
}

/** Reads one of our JSON files (config or baseline) from inside the first root. */
export async function readOwnFile(sandbox: Sandbox, p: string, what: string): Promise<{ text: string; display: string; size: number }> {
  insidePrimary(sandbox, p, what);
  const f = await sandbox.openAs("asitisrc", p, { baseDir: sandbox.primary.real });
  if (f.root !== sandbox.primary) throw new UserError(`Refused: ${what} ${p} is outside the project folder; it must be inside it.`);
  return { text: f.buf.toString("utf8"), display: f.rel, size: f.buf.length };
}

export async function loadConfig(sandbox: Sandbox, opts: { configPath?: string }): Promise<LoadedConfig | null> {
  let target = opts.configPath;
  if (target === undefined) {
    const p = await sandbox.probe(CONFIG_FILE, sandbox.primary.real);
    if (p.state === "missing") return null;
    if (p.state === "outside") throw new UserError(`Refused: ${CONFIG_FILE} is a symlink that resolves outside the project folder.`);
    target = CONFIG_FILE;
  }
  const { text, display, size } = await readOwnFile(sandbox, target, "config file");
  if (size > CONFIG_MAX_BYTES) throw new UserError(`File too large: ${display} is ${fmt(size)} bytes; the limit is ${fmt(CONFIG_MAX_BYTES)} bytes for AsItIs config files.`);
  return validateConfig(parseJsonLines(text, display), display);
}

// ---------------------------------------------------------------------------------------------
// Globs: "**" any number of folders, "*" and "?" inside one name. A pattern with no "/" matches a
// name at any depth, a trailing "/" means a folder, and a pattern that matches a folder matches
// everything in it (as in .gitignore). Matching is per segment with memoised "**", so it stays
// polynomial in the pattern and path length whatever the pattern is.

function segMatch(p: string, s: string): boolean {
  // Iterative wildcard match with one backtrack point: O(len(p) * len(s)) worst case.
  let pi = 0;
  let si = 0;
  let star = -1;
  let mark = 0;
  while (si < s.length) {
    if (pi < p.length && (p[pi] === "?" || p[pi] === s[si])) {
      pi++;
      si++;
    } else if (pi < p.length && p[pi] === "*") {
      star = pi++;
      mark = si;
    } else if (star >= 0) {
      pi = star + 1;
      si = ++mark;
    } else return false;
  }
  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}

function compileGlob(glob: string): string[] {
  let g = glob.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  const anchored = glob.trim().replace(/^\.\//, "/").startsWith("/") || g.replace(/\/+$/, "").includes("/");
  if (g.endsWith("/")) g = `${g.replace(/\/+$/, "")}/**`;
  const segs = g.split("/").filter((x) => x !== "");
  return anchored ? segs : ["**", ...segs];
}

/** Pattern segments against the path segments or any leading part of them (a folder above the file). */
function matchSegs(p: readonly string[], s: readonly string[]): boolean {
  // memo[i * (s.length + 1) + j]: 0 unknown, 1 false, 2 true. At most p.length * s.length states.
  const memo = new Uint8Array((p.length + 1) * (s.length + 1));
  const go = (i: number, j: number): boolean => {
    const key = i * (s.length + 1) + j;
    if (memo[key]) return memo[key] === 2;
    let r: boolean;
    if (i === p.length) r = j >= 1;
    else if (p[i] === "**") r = go(i + 1, j) || (j < s.length && go(i, j + 1));
    else r = j < s.length && segMatch(p[i]!, s[j]!) && go(i + 1, j + 1);
    memo[key] = r ? 2 : 1;
    return r;
  };
  return go(0, 0);
}

const compiled = new Map<string, string[]>();

/** True when the root-relative POSIX path, or a folder above it, matches one of the globs. */
export function matchesAny(globs: readonly string[], relPosix: string): boolean {
  if (!globs.length) return false;
  const parts = relPosix.split("/").filter((x) => x !== "");
  if (!parts.length) return false;
  for (const g of globs) {
    let segs = compiled.get(g);
    if (!segs) {
      segs = compileGlob(g);
      if (compiled.size > 10_000) compiled.clear();
      compiled.set(g, segs);
    }
    if (matchSegs(segs, parts)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Applying

/** The effective setting of every configured rule for one file: preset, rules, then matching overrides. */
function settingsFor(cfg: LoadedConfig, rel: string | null): Map<string, RuleSetting> {
  const m = new Map<string, RuleSetting>();
  const put = (rules: Record<string, RuleSetting>): void => {
    for (const [id, s] of Object.entries(rules)) {
      const prev = m.get(id);
      // Options merge so an override can change one threshold and keep the rest.
      m.set(id, s.options || prev?.options ? { severity: s.severity, options: { ...prev?.options, ...s.options } } : { severity: s.severity });
    }
  };
  put(cfg.rules);
  if (rel !== null) for (const o of cfg.overrides) if (matchesAny(o.files, rel)) put(o.rules);
  return m;
}

const issueSeverity = (s: Exclude<ConfigSeverity, "off">): Severity => (s === "note" ? "info" : s);

/** Root-relative POSIX path used for globs, or null for a file outside the first root. */
function relOf(result: LintResult, doc: Doc | undefined): string | null {
  if (doc) return doc.file.root.extra ? null : doc.file.rel;
  return /^([A-Za-z]:)?[\\/]/.test(result.path) || result.path.includes(" (symlink to ") ? null : result.path;
}

const fmt = (x: number): string => x.toLocaleString("en-US");

/**
 * Re-checks the length rule against the thresholds in config. lint.ts used the vendor numbers from
 * limits.ts; this replaces the finding it made for the configured measure (or adds one when the
 * configured limit is lower). The MEMORY.md 25 KB finding has no option and is left alone.
 */
function applyThresholds(doc: Doc, issues: Issue[], o: LengthOptions): Issue[] {
  const kind = doc.kind.kind;
  const lines = doc.profile.lines;
  type Spec = { limit: number | undefined; value: number; mine: (i: Issue) => boolean; message: (limit: number) => string; line?: (limit: number) => number };
  const linesMsg = (what: string, vendor: string) => (limit: number) => `${fmt(lines)} lines; over the limit of ${fmt(limit)} lines this project sets for ${what} in .asitisrc.json (${vendor}). Shorten it or move detail into files it links to`;
  const spec: Spec | null =
    kind === "claude-md"
      ? { limit: o.claudeMdLines, value: lines, mine: () => true, message: linesMsg("CLAUDE.md", `Claude Code recommends under ${VENDOR.claudeMdTargetLines}`) }
      : kind === "skill"
        ? { limit: o.skillMdLines, value: lines, mine: () => true, message: linesMsg("SKILL.md", `the Claude Code skills docs say under ${VENDOR.skillMaxLines}`) }
        : kind === "cursor-rule"
          ? { limit: o.cursorRuleLines, value: lines, mine: () => true, message: linesMsg("Cursor rules", `Cursor recommends under ${VENDOR.cursorRuleLines}`) }
          : kind === "agents-md"
            ? { limit: o.codexBytes, value: doc.profile.bytes, mine: () => true, message: (limit) => `${fmt(doc.profile.bytes)} bytes; over the limit of ${fmt(limit)} bytes this project sets for AGENTS.md in .asitisrc.json (Codex reads ${fmt(VENDOR.codexAgentsMdBytes)} bytes by default). Shorten it or move detail into docs it links to` }
            : kind === "windsurf-rule"
              ? { limit: o.windsurfChars, value: doc.text.length, mine: () => true, message: (limit) => `${fmt(doc.text.length)} characters; over the limit of ${fmt(limit)} characters this project sets for Windsurf rules in .asitisrc.json (Windsurf allows ${fmt(VENDOR.windsurfRuleChars)}). Shorten it` }
              : kind === "memory-index"
                ? {
                    limit: o.memoryIndexLines,
                    value: lines,
                    mine: (i) => /^[\d,]+ lines;/.test(i.message),
                    message: (limit) => `${fmt(lines)} lines; over the limit of ${fmt(limit)} lines this project sets for MEMORY.md in .asitisrc.json (Claude Code loads only the first ${VENDOR.memoryIndexLines}). Move detail into topic files`,
                    line: (limit) => Math.min(limit + 1, Math.max(1, lines)),
                  }
                : null;
  if (!spec || spec.limit === undefined) return issues;
  const limit = spec.limit;
  const kept = issues.filter((i) => i.rule !== "length" || !spec.mine(i));
  if (spec.value > limit) kept.push({ severity: "warning", rule: "length", message: spec.message(limit), line: spec.line ? spec.line(limit) : 1 });
  return kept;
}

/**
 * Security findings that the repo's own .asitisrc.json or baseline would hide. With trust (the
 * CLI and the Action, run on purpose in the user's own repo) they are hidden but counted, marked
 * suppressed with kind "external", and summed up in one line. Without trust (lint_steering, unless
 * the call passes trustRepoConfig) the config is not applied to security rules at all and the
 * counts say what it asked for. Either way nothing about a security finding disappears silently.
 */
export interface HiddenSecurity {
  /** True when the repo's config was applied to security rules. */
  trusted: boolean;
  /** Turned off in rules or overrides. */
  off: number;
  offRules: string[];
  /** Lowered to a less severe level. */
  lowered: number;
  loweredRules: string[];
  /** In files that match an ignore pattern. */
  ignored: number;
  ignoredFiles: string[];
  /** Listed in the baseline file. */
  baseline: number;
}

export const emptyHidden = (trusted: boolean): HiddenSecurity => ({ trusted, off: 0, offRules: [], lowered: 0, loweredRules: [], ignored: 0, ignoredFiles: [], baseline: 0 });

export const hiddenTotal = (h: HiddenSecurity): number => h.off + h.lowered + h.ignored + h.baseline;

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const isSecurity = (id: string): boolean => getRule(id)?.category === "security";
const addOnce = (list: string[], v: string): void => {
  if (!list.includes(v)) list.push(v);
};

/**
 * Applies config, inline suppressions and the baseline to the results of one lintProject call.
 * Returns what happened to security findings; see HiddenSecurity.
 */
export async function applyConfig(config: LoadedConfig | null, run: ConfigRun): Promise<HiddenSecurity> {
  const { results, docs } = run;
  const trusted = run.trustRepoConfig === true;
  const hidden = emptyHidden(trusted);
  const cfgName = config?.path ?? CONFIG_FILE;
  // 1. ignore: drop the files, for named paths too (a pre-commit run passes ignored files as well).
  // A file with security findings is never dropped silently: with trust its security findings stay
  // in the report as suppressed, without trust they stay as they are. Either way the rest go.
  if (config?.ignore.length) {
    for (let k = results.length - 1; k >= 0; k--) {
      const doc = k < docs.length ? docs[k] : undefined;
      const r = results[k]!;
      const rel = relOf(r, doc);
      if (rel === null || !matchesAny(config.ignore, rel)) continue;
      const sec = r.issues.filter((i) => isSecurity(i.rule) && !i.suppressed && !i.strictOnly);
      if (!sec.length) {
        results.splice(k, 1);
        if (doc) docs.splice(k, 1);
        continue;
      }
      r.issues = sec;
      hidden.ignored += sec.length;
      addOnce(hidden.ignoredFiles, r.path);
      if (trusted) for (const i of sec) i.suppressed = { kind: "external", justification: `the file matches an ignore pattern in ${cfgName}` };
    }
  }
  const strict = config?.extends === "strict";
  results.forEach((r, k) => {
    // 1b. inventory notes exist only under extends: strict.
    // The flag itself never reaches the output.
    if (r.issues.some((i) => i.strictOnly)) r.issues = r.issues.filter((i) => strict || !i.strictOnly).map(({ strictOnly: _, ...i }) => i);
    const doc = k < docs.length ? docs[k] : undefined;
    const settings = config ? settingsFor(config, relOf(r, doc)) : new Map<string, RuleSetting>();
    const off = (id: string): boolean => settings.get(id)?.severity === "off";
    // 2. thresholds
    const lengthOpts = settings.get("length")?.options;
    if (doc && lengthOpts) r.issues = applyThresholds(doc, r.issues, lengthOpts);
    // 3. asitis-disable comments (markdown files only)
    if (doc) {
      const extra = applyInlineSuppressions(doc, r.issues, parseSuppressions(doc), off);
      r.issues.push(...extra);
    }
    // 4. severity and off. Explicit settings win; strict raises notes to warnings for the rest.
    if (config) {
      const kept: Issue[] = [];
      for (const i of r.issues) {
        const sec = isSecurity(i.rule) && !i.suppressed;
        if (off(i.rule)) {
          if (!sec) continue;
          hidden.off++;
          addOnce(hidden.offRules, i.rule);
          if (trusted) i.suppressed = { kind: "external", justification: `${i.rule} is turned off in ${cfgName}` };
          kept.push(i);
          continue;
        }
        const s = settings.get(i.rule)?.severity;
        if (s && s !== "off") {
          const to = issueSeverity(s);
          if (sec && SEVERITY_ORDER[to] > SEVERITY_ORDER[i.severity]) {
            hidden.lowered++;
            addOnce(hidden.loweredRules, i.rule);
            if (trusted) i.severity = to;
          } else i.severity = to;
        } else if (strict && i.severity === "info") i.severity = "warning";
        kept.push(i);
      }
      r.issues = kept;
    }
  });
  // 5. baseline: fingerprints exactly as findings() computes them.
  if (run.baselinePath !== undefined) {
    const baseline = await loadBaseline(run.sandbox, run.baselinePath);
    const sources: FindingSource[] = results.map((result, k) => {
      const doc = k < docs.length ? docs[k] : undefined;
      if (doc) return { result, path: findingPath(doc), lineText: (line) => (line >= 1 && line <= doc.lines.count ? doc.lines.line(line - 1) : "") };
      return { result, path: result.path, lineText: run.lineTexts?.get(result.path) ?? (() => "") };
    });
    hidden.baseline += markBaselined(sources, baseline, trusted);
  }
  hidden.offRules.sort();
  hidden.loweredRules.sort();
  return hidden;
}

/**
 * The one line that says what happened to security findings, or null when nothing did. With
 * trust: "3 security findings hidden by .asitisrc.json (rules off: a, b) and 1 by the baseline."
 * Without: they are shown, and the line says how to apply the repo's config to them.
 */
export function hiddenSecurityNote(h: HiddenSecurity, configName: string, baselineName = "the baseline"): string | null {
  const total = hiddenTotal(h);
  if (!total) return null;
  const count = (x: number): string => `${x.toLocaleString("en-US")} security ${x === 1 ? "finding" : "findings"}`;
  const why: string[] = [];
  if (h.offRules.length) why.push(`rules off: ${h.offRules.join(", ")}`);
  if (h.loweredRules.length) why.push(`lowered: ${h.loweredRules.join(", ")}`);
  if (h.ignoredFiles.length) why.push(`ignored ${h.ignoredFiles.length === 1 ? "file" : "files"}: ${h.ignoredFiles.slice(0, 5).map((f) => q(f, 120)).join(", ")}${h.ignoredFiles.length > 5 ? ` and ${h.ignoredFiles.length - 5} more` : ""}`);
  const byConfig = h.off + h.lowered + h.ignored;
  if (h.trusted) {
    const parts: string[] = [];
    if (byConfig) parts.push(`${count(byConfig)} ${h.lowered ? (h.lowered === byConfig ? "lowered" : "hidden or lowered") : "hidden"} by ${configName} (${why.join("; ")})`);
    if (h.baseline) parts.push(byConfig ? `${h.baseline.toLocaleString("en-US")} by ${baselineName}` : `${count(h.baseline)} hidden by ${baselineName}`);
    return `${parts.join(" and ")}.${h.off + h.ignored + h.baseline ? " Hidden ones stay in the report, marked suppressed." : ""}`;
  }
  return `${count(total)} shown although ${configName} turns them off, lowers them or ignores their files (${why.join("; ")}). A repo's own config cannot hide security findings from this tool; pass trustRepoConfig: true to apply it to them.`;
}

/**
 * Marks issues whose fingerprint is in the baseline. Issues are ordered and counted exactly as
 * toFindings() in findings.ts does, so the fingerprint here is the one the report will show.
 */
function markBaselined(sources: FindingSource[], baseline: ReadonlySet<string>, trusted: boolean): number {
  let hiddenSecurity = 0;
  if (!baseline.size) return 0;
  for (const s of sources) {
    const order = [...s.result.issues].sort((a, b) => a.line - b.line || (a.column ?? 1) - (b.column ?? 1));
    const seen = new Map<string, number>();
    for (const i of order) {
      const text = fingerprintTextOf(i, s.lineText);
      const key = `${i.rule}\0${normaliseLineText(text)}`;
      const occurrence = seen.get(key) ?? 0;
      seen.set(key, occurrence + 1);
      if (i.suppressed || !baseline.has(fingerprint(i.rule, s.path, text, occurrence))) continue;
      if (isSecurity(i.rule)) {
        hiddenSecurity++;
        if (!trusted) continue;
      }
      i.suppressed = { kind: "external", justification: "listed in the baseline file" };
    }
  }
  return hiddenSecurity;
}
