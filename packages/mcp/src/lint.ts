// lint_steering: checks one steering file against vendor rules and for hidden content.

import path from "node:path";
import type { Doc } from "./doc.js";
import type { Kind } from "./kinds.js";
import { CAPS, VENDOR } from "./limits.js";
import type { Sandbox } from "./paths.js";
import { extractImports, extractLinks, isExternalTarget, scanComments, scanHiddenStyles, scanInvisible } from "./scan.js";
import { approxTokens } from "./tokens.js";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  rule: string;
  message: string;
  line: number;
}

export interface LintResult {
  path: string;
  kind: Kind;
  load: string;
  tokens: number;
  issues: Issue[];
}

// Frontmatter keys each tool reads. Sources: Claude Code skills, sub-agents and
// memory docs; Agent Skills spec; Cursor rules docs; VS Code custom instructions docs.
const SKILL_KEYS = [
  "name", "description", "when_to_use", "argument-hint", "arguments", "disable-model-invocation", "user-invocable",
  "allowed-tools", "disallowed-tools", "model", "effort", "context", "agent", "background", "hooks", "paths", "shell",
  "metadata", "license", "compatibility", "version",
];
const KNOWN_KEYS: Partial<Record<Kind, { keys: string[]; reader: string }>> = {
  skill: { keys: SKILL_KEYS, reader: "Claude Code or the Agent Skills spec" },
  "claude-command": { keys: SKILL_KEYS, reader: "Claude Code commands" },
  "claude-agent": {
    keys: ["name", "description", "tools", "disallowedTools", "model", "permissionMode", "maxTurns", "skills", "mcpServers", "hooks", "memory", "background", "omitClaudeMd", "effort", "isolation", "color", "initialPrompt", "experimental"],
    reader: "Claude Code subagents",
  },
  "claude-rule": { keys: ["paths", "description"], reader: "Claude Code rules" },
  "cursor-rule": { keys: ["description", "globs", "alwaysApply"], reader: "Cursor rules" },
  "copilot-scoped": { keys: ["applyTo", "description", "name", "excludeAgent"], reader: "VS Code Copilot instructions" },
  "prompt-file": { keys: ["description", "name", "mode", "agent", "model", "tools", "argument-hint"], reader: "VS Code prompt files" },
  "windsurf-rule": { keys: ["trigger", "globs", "description"], reader: "Windsurf rules" },
  "memory-topic": { keys: ["name", "description", "type", "modified", "created", "updated", "metadata"], reader: "Claude Code memory" },
};

const IMPORT_KINDS: Kind[] = ["claude-md", "agents-md", "gemini-md", "claude-rule"];
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class Collector {
  readonly issues: Issue[] = [];
  private readonly perRule = new Map<string, number>();
  add(severity: Severity, rule: string, message: string, line = 1): void {
    const n = this.perRule.get(rule) ?? 0;
    this.perRule.set(rule, n + 1);
    if (n < CAPS.maxFindingsPerRule) this.issues.push({ severity, rule, message, line });
    else if (n === CAPS.maxFindingsPerRule) this.issues.push({ severity: "info", rule, message: `More ${rule} findings in this file were not listed`, line });
  }
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const isStrOrList = (v: unknown): boolean => typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"));

function checkFrontmatter(doc: Doc, c: Collector): void {
  const fm = doc.frontmatter;
  for (const p of fm.problems) c.add(p.rule === "frontmatter-bom" ? "warning" : "error", p.rule, p.message, p.line);
  const kind = doc.kind.kind;
  const data = fm.present ? fm.data : null;
  const line = (k: string): number => fm.keyLines[k] ?? 1;

  if (kind === "skill") {
    if (!fm.present && !fm.problems.length) c.add("error", "missing-frontmatter", "SKILL.md needs YAML frontmatter starting on line 1 with name and description");
    if (data) {
      const name = data["name"];
      const dir = path.posix.basename(path.posix.dirname(doc.file.rel));
      if (name === undefined || name === null || name === "") {
        c.add("error", "missing-name", "name is required by the Agent Skills spec (Codex, Cursor, Copilot and Gemini CLI read it); Claude Code falls back to the folder name");
      } else {
        const n = String(name);
        if (n.length > VENDOR.skillNameMax) c.add("error", "name-too-long", `name is ${n.length} characters; the Agent Skills spec allows ${VENDOR.skillNameMax}`, line("name"));
        if (!SKILL_NAME.test(n)) c.add("error", "name-format", `name "${n.slice(0, 80)}" must be lowercase letters, digits and single hyphens (Agent Skills spec)`, line("name"));
        if (dir && dir !== "." && dir !== n) c.add("warning", "name-dir-mismatch", `name "${n.slice(0, 80)}" does not match its folder "${dir}"; the spec expects them to match`, line("name"));
      }
      const desc = data["description"];
      if (desc === undefined || desc === null || (typeof desc === "string" && desc.trim() === "")) {
        c.add("error", "missing-description", "description is required: it is what the agent reads to decide when to load the skill (Claude Code falls back to the first paragraph)", line("description"));
      } else if (typeof desc !== "string") {
        c.add("error", "field-type", "description must be a string", line("description"));
      } else {
        if (desc.length > VENDOR.skillDescriptionMax) {
          c.add("warning", "description-too-long", `description is ${desc.length} characters; the Agent Skills spec allows ${VENDOR.skillDescriptionMax}`, line("description"));
        }
        const combined = desc.length + (str(data["when_to_use"])?.length ?? 0);
        if (combined > VENDOR.skillListingChars) {
          c.add("warning", "description-truncated", `description plus when_to_use is ${combined} characters; Claude Code truncates the skill listing at ${VENDOR.skillListingChars}, so put the key use case first`, line("description"));
        }
      }
      for (const b of ["disable-model-invocation", "user-invocable", "background"]) {
        if (data[b] !== undefined && typeof data[b] !== "boolean") c.add("error", "field-type", `${b} must be true or false`, line(b));
      }
      for (const l of ["allowed-tools", "disallowed-tools", "paths"]) {
        if (data[l] !== undefined && !isStrOrList(data[l])) c.add("error", "field-type", `${l} must be a string or a list of strings`, line(l));
      }
      const compat = str(data["compatibility"]);
      if (compat && compat.length > VENDOR.skillCompatibilityMax) c.add("warning", "compatibility-too-long", `compatibility is ${compat.length} characters (max ${VENDOR.skillCompatibilityMax})`, line("compatibility"));
    }
  } else if (kind === "claude-agent") {
    if (!fm.present && !fm.problems.length) c.add("error", "missing-frontmatter", "Subagent files need frontmatter with name and description");
    if (data) {
      if (!str(data["name"])) c.add("error", "missing-name", "name is required for a Claude Code subagent");
      if (!str(data["description"])) c.add("error", "missing-description", "description is required: Claude uses it to decide when to delegate");
      if (data["tools"] !== undefined && !isStrOrList(data["tools"])) c.add("error", "field-type", "tools must be a comma-separated string or a list", line("tools"));
    }
  } else if (kind === "cursor-rule") {
    if (!fm.present && !fm.problems.length) c.add("warning", "missing-frontmatter", ".mdc rules need frontmatter (description, globs, alwaysApply); without it the rule only applies when @-mentioned");
    if (data) {
      if (data["alwaysApply"] !== undefined && typeof data["alwaysApply"] !== "boolean") {
        c.add("error", "field-type", `alwaysApply must be true or false, not ${JSON.stringify(data["alwaysApply"])}`, line("alwaysApply"));
      }
      if (data["globs"] !== undefined && data["globs"] !== null && !isStrOrList(data["globs"])) c.add("error", "field-type", "globs must be a string or a list of strings", line("globs"));
      if (data["alwaysApply"] !== true && !data["globs"] && !data["description"]) {
        c.add("warning", "never-applied", "No alwaysApply, globs or description: Cursor applies this rule only when you @-mention it");
      }
    }
  } else if (kind === "claude-rule") {
    if (data && data["paths"] !== undefined && !isStrOrList(data["paths"])) c.add("error", "field-type", "paths must be a glob string or a list of globs", line("paths"));
  } else if (kind === "copilot-scoped") {
    if (!data || !data["applyTo"]) c.add("warning", "missing-applyTo", "*.instructions.md files need applyTo in frontmatter, or they are only used when attached manually");
  } else if (kind === "memory-topic") {
    if (!fm.present && !fm.problems.length) c.add("info", "missing-frontmatter", "Memory topic files usually carry name, description and type frontmatter");
    if (data) {
      const t = data["type"];
      if (t !== undefined && !["user", "feedback", "project", "reference"].includes(String(t))) {
        c.add("warning", "memory-type", `Unknown memory type "${String(t).slice(0, 40)}" (expected user, feedback, project or reference)`, line("type"));
      }
      if (!str(data["description"])) c.add("warning", "missing-description", "Memory files need a description so the index entry says when they matter");
    }
  }

  const known = KNOWN_KEYS[kind];
  if (known && data) {
    for (const k of Object.keys(data)) {
      if (!known.keys.includes(k)) c.add("info", "unknown-key", `Frontmatter key "${k.slice(0, 60)}" is not read by ${known.reader}; it is kept but ignored`, line(k));
    }
  }
}

function checkLength(doc: Doc, c: Collector, tokens: number): void {
  const kind = doc.kind.kind;
  const lines = doc.profile.lines;
  const bytes = doc.profile.bytes;
  if (kind === "claude-md" && lines > VENDOR.claudeMdTargetLines) {
    c.add("warning", "length", `${lines} lines; Claude Code recommends under ${VENDOR.claudeMdTargetLines} per CLAUDE.md. Move path-specific parts into .claude/rules with paths frontmatter`);
  }
  if (kind === "skill" && lines > VENDOR.skillMaxLines) c.add("warning", "length", `${lines} lines; keep SKILL.md under ${VENDOR.skillMaxLines} and move detail to referenced files`);
  if (kind === "cursor-rule" && lines > VENDOR.cursorRuleLines) c.add("warning", "length", `${lines} lines; Cursor recommends rules under ${VENDOR.cursorRuleLines} lines`);
  if (kind === "agents-md" && bytes > VENDOR.codexAgentsMdBytes) {
    c.add("warning", "length", `${bytes} bytes; Codex reads at most ${VENDOR.codexAgentsMdBytes} bytes of AGENTS.md by default (project_doc_max_bytes), so the rest is dropped`);
  }
  if (kind === "windsurf-rule" && doc.text.length > VENDOR.windsurfRuleChars) c.add("warning", "length", `${doc.text.length} characters; Windsurf limits rule files to ${VENDOR.windsurfRuleChars}`);
  if (kind === "memory-index") {
    if (lines > VENDOR.memoryIndexLines) c.add("warning", "length", `${lines} lines; Claude Code loads only the first ${VENDOR.memoryIndexLines} lines of MEMORY.md, so later entries never load`, VENDOR.memoryIndexLines + 1);
    if (bytes > VENDOR.memoryIndexBytes) c.add("warning", "length", `${bytes} bytes; Claude Code loads only the first 25 KB of MEMORY.md`);
  }
  if (doc.kind.load === "every-session" && tokens > 5000) c.add("info", "context-cost", `About ${tokens} tokens load every session; long steering files are followed less reliably`);
}

function checkProfile(doc: Doc, c: Collector): void {
  const p = doc.profile;
  if (p.encoding !== "utf-8") c.add("warning", "encoding", `File is ${p.encoding}; most agent tools expect UTF-8 steering files`);
  if (p.invalidUtf8.count > 0) {
    const r = p.invalidUtf8.ranges[0]!;
    c.add("warning", "invalid-utf8", `${p.invalidUtf8.count} invalid UTF-8 byte sequence(s), first at byte ${r.start}; tools that decode and re-save will replace them`);
  }
  if (p.nulBytes > 0) c.add("warning", "nul-bytes", `${p.nulBytes} NUL byte(s); this may be a binary file`);
  if (p.eol.style === "mixed") c.add("info", "mixed-eol", `Mixed line endings (${p.eol.crlf} CRLF, ${p.eol.lf} LF, ${p.eol.cr} CR). Edit minimal ranges so they stay as they are`);
}

function checkHidden(doc: Doc, c: Collector): void {
  const inv = scanInvisible(doc.lines);
  for (const f of inv.findings) {
    c.add(
      "warning",
      f.bidi ? "bidi-control" : "invisible-char",
      `${f.count} invisible character(s): ${f.codepoints.join(", ")}.${f.bidi ? " Bidirectional controls can make text read differently than it displays." : ""} Agents read these; people do not see them`,
      f.line,
    );
  }
  const com = scanComments(doc.lines, doc.fence);
  let benign = 0;
  for (const f of com.findings) {
    if (!f.closed) c.add("warning", "unclosed-comment", `An HTML comment opens here and never closes, so everything after it is hidden in rendered views`, f.line);
    if (f.instructionLike) {
      c.add("warning", "hidden-instruction", `Hidden HTML comment ${f.matched}: "${f.preview.slice(0, 80)}". It is invisible when rendered but agents reading the raw file see it`, f.line);
    } else benign++;
  }
  const benignTotal = benign + Math.max(0, com.total - com.findings.length);
  if (benignTotal > 0) {
    const note = doc.kind.kind === "claude-md" ? " Claude Code strips block-level comments before loading CLAUDE.md, but its Read tool still sees them." : "";
    c.add("info", "hidden-comment", `${benignTotal} HTML comment(s) are hidden in rendered views.${note}`, com.findings.find((f) => !f.instructionLike)?.line ?? 1);
  }
  for (const line of scanHiddenStyles(doc.lines, doc.fence)) c.add("warning", "hidden-styled-text", "Inline style hides text (display:none, zero size, zero opacity or white text)", line);
}

function checkRules(doc: Doc, c: Collector): void {
  // Heuristics: exact duplicate rule lines, and "always X" next to "never X".
  const seen = new Map<string, number>();
  const pos = new Map<string, number>();
  const neg = new Map<string, number>();
  const start = doc.frontmatter.present ? doc.frontmatter.endLine + 1 : 0;
  for (let i = start; i < doc.lines.count; i++) {
    if (doc.fence[i]) continue;
    const len = doc.lines.end(i) - doc.lines.start(i);
    if (len < 12 || len > 400) continue;
    const norm = trimEndChars(
      doc.lines
        .line(i)
        .toLowerCase()
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
      ".!;:, ",
    );
    if (norm.length < 12 || norm.startsWith("#") || norm.startsWith("|") || norm.startsWith("<!--")) continue;
    const first = seen.get(norm);
    if (first !== undefined) c.add("warning", "duplicate-rule", `Same rule as line ${first}; duplicated rules cost context and drift apart when one is edited`, i + 1);
    else seen.set(norm, i + 1);
    const p = /^(?:always|you must|must|you should|should|do) (.{4,})$/.exec(norm);
    const n = /^(?:never|do not|don't|must not|mustn't|should not|shouldn't) (.{4,})$/.exec(norm);
    if (p) {
      const other = neg.get(p[1]!);
      if (other !== undefined) c.add("warning", "contradiction", `Looks contradictory with line ${other} (one says do, the other says do not)`, i + 1);
      if (!pos.has(p[1]!)) pos.set(p[1]!, i + 1);
    } else if (n) {
      const other = pos.get(n[1]!);
      if (other !== undefined) c.add("warning", "contradiction", `Looks contradictory with line ${other} (one says do, the other says do not)`, i + 1);
      if (!neg.has(n[1]!)) neg.set(n[1]!, i + 1);
    }
  }
}

/** Trims trailing characters from a set without a backtracking regex. */
function trimEndChars(s: string, chars: string): string {
  let e = s.length;
  while (e > 0 && chars.includes(s[e - 1]!)) e--;
  return s.slice(0, e);
}

function safeDecode(t: string): string {
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

async function checkLinks(doc: Doc, sandbox: Sandbox, c: Collector): Promise<void> {
  const dir = path.dirname(doc.file.real);
  const links = extractLinks(doc.lines, doc.fence);
  const cache = new Map<string, string>();
  for (const l of links) {
    if (isExternalTarget(l.target)) continue;
    let t = l.target;
    const h = t.search(/[#?]/);
    if (h >= 0) t = t.slice(0, h);
    if (!t) continue;
    t = safeDecode(t);
    if (t.startsWith("/")) continue; // site-absolute paths depend on the renderer
    let state = cache.get(t);
    if (!state) {
      state = (await sandbox.probe(t, dir)).state;
      cache.set(t, state);
    }
    if (state === "missing") c.add("warning", "broken-link", `Relative link target not found: ${l.target.slice(0, 200)}`, l.line);
    else if (state === "outside") c.add("info", "link-outside-root", `Link points outside the allowed folder and was not checked: ${l.target.slice(0, 200)}`, l.line);
  }
  if (!IMPORT_KINDS.includes(doc.kind.kind)) return;
  const imports = extractImports(doc.lines, doc.fence, doc.frontmatter.present ? doc.frontmatter.endLine : -1);
  for (const im of imports) {
    if (im.path.startsWith("~")) {
      c.add("warning", "import-outside-root", `@${im.path.slice(0, 200)} imports from your home folder. Claude Code asks for approval of external imports; teammates will not have this file`, im.line);
      continue;
    }
    const probe = await sandbox.probe(im.path, dir);
    if (probe.state === "missing") {
      c.add(
        im.looksLikePath ? "warning" : "info",
        "broken-import",
        `@${im.path.slice(0, 200)} is read as an import but the file does not exist${im.looksLikePath ? "" : ". If this is not a file, wrap it in backticks"}`,
        im.line,
      );
    } else if (probe.state === "outside") {
      c.add("warning", "import-outside-root", `@${im.path.slice(0, 200)} resolves outside the allowed folder; Claude Code shows an approval dialog for external imports`, im.line);
    }
  }
}

export async function lintDoc(doc: Doc, sandbox: Sandbox): Promise<LintResult> {
  const c = new Collector();
  const body = doc.frontmatter.present ? doc.text.slice(doc.lines.start(Math.min(doc.frontmatter.endLine + 1, doc.lines.count - 1))) : doc.text;
  const tokens = approxTokens(body);
  checkFrontmatter(doc, c);
  checkLength(doc, c, tokens);
  checkProfile(doc, c);
  checkHidden(doc, c);
  checkRules(doc, c);
  await checkLinks(doc, sandbox, c);
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  c.issues.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
  return { path: doc.path, kind: doc.kind.kind, load: doc.kind.load, tokens, issues: c.issues };
}
