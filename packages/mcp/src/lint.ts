// lint_steering: checks one steering file against vendor rules and for hidden content.

import path from "node:path";
import { analyse, type Doc } from "./doc.js";
import { outline } from "./outline.js";
import type { Kind } from "./kinds.js";
import { CAPS, VENDOR } from "./limits.js";
import type { Sandbox } from "./paths.js";
import { esc, hasUnsafe, q } from "./escape.js";
import { extractImports, extractLinks, importIsSurelyFile, isExternalTarget, scanComments, scanHiddenStyles, scanInvisible, scanRefComments } from "./scan.js";
import { looksLikeSuppression } from "./suppress.js";
import { lineOfByte } from "./text.js";
import { approxTokens } from "./tokens.js";
import { DANGEROUS_HIDDEN_SEVERITY } from "./rules/core.meta.js";
import { hygieneIssues } from "./fixes/hygiene.js";
import { inTemplateFolder, inTestTree, notProjectInstructions, topLevelSkill } from "./places.js";
import { GITMODULES_FILE, submodulePaths } from "./policy/gitmodules.js";
import type { FindingFix, Suppression } from "./findings.js";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  rule: string;
  message: string;
  line: number;
  /** Optional span, 1-based, UTF-16 columns, endColumn exclusive. Without it a finding covers its whole line. */
  column?: number;
  endLine?: number;
  endColumn?: number;
  /** Set by config.ts (rule off in .asitisrc.json, baseline) or suppress.ts (asitis-disable comments). */
  suppressed?: Suppression;
  /** Set by fix.ts when --fix-preview or suggest_fixes asks for fixes. */
  fix?: FindingFix;
  /**
   * What the fingerprint hashes in place of the line's text, for a finding whose line moves when
   * the file does not really change (codex-chain-over-budget is reported on the byte where Codex
   * cuts, which shifts with CRLF or any edit above it). findings.ts, fingerprintTextOf().
   */
  fingerprintText?: string;
  /**
   * An inventory note that is useful in a review but too common to show by default (a plain hook,
   * a subagent with no tools list). applyConfig drops it unless the config says extends: strict.
   */
  strictOnly?: boolean;
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
  "metadata", "license", "compatibility",
];
// Claude Code skills docs: commands take "the same frontmatter except name and paths".
const COMMAND_KEYS = SKILL_KEYS.filter((k) => k !== "name" && k !== "paths");
const KNOWN_KEYS: Partial<Record<Kind, { keys: string[]; reader: string }>> = {
  skill: { keys: SKILL_KEYS, reader: "Claude Code or the Agent Skills spec" },
  "claude-command": { keys: COMMAND_KEYS, reader: "Claude Code commands (they take skill fields except name and paths)" },
  "claude-agent": {
    keys: ["name", "description", "tools", "disallowedTools", "model", "permissionMode", "maxTurns", "skills", "mcpServers", "hooks", "memory", "background", "omitClaudeMd", "effort", "isolation", "color", "initialPrompt", "experimental"],
    reader: "Claude Code subagents",
  },
  // Claude Code memory docs: "paths is the only field Claude Code reads from a rule".
  "claude-rule": { keys: ["paths"], reader: "Claude Code rules (paths is the only field they read)" },
  "cursor-rule": { keys: ["description", "globs", "alwaysApply"], reader: "Cursor rules" },
  "copilot-scoped": { keys: ["applyTo", "description", "name", "excludeAgent"], reader: "VS Code Copilot instructions" },
  "prompt-file": { keys: ["description", "name", "mode", "agent", "model", "tools", "argument-hint"], reader: "VS Code prompt files" },
  "windsurf-rule": { keys: ["trigger", "globs", "description"], reader: "Windsurf rules" },
  // Claude Code memory docs document type and modified; Claude Code's own memory files also carry name and description.
  "memory-topic": { keys: ["name", "description", "type", "modified", "created", "updated", "metadata"], reader: "Claude Code memory" },
};

// Only files that are read with @path imports: CLAUDE.md, rules and GEMINI.md. AGENTS.md is read
// with its imports by Claude Code 2.1.277 and later only when the folder has no CLAUDE.md (Claude
// Code memory docs, "AGENTS.md"); with a CLAUDE.md beside it, Codex has no imports and an
// @scope/package there is just text.
const IMPORT_KINDS: Kind[] = ["claude-md", "gemini-md", "claude-rule"];

/** Whether Claude Code reads this AGENTS.md itself: no CLAUDE.md or CLAUDE.local.md beside it, or a CLAUDE.md that is a link to it. */
async function claudeReadsAgentsMd(doc: Doc, sandbox: Sandbox): Promise<boolean> {
  const dir = path.dirname(doc.file.lexical ?? doc.file.real);
  const names = path.dirname(doc.file.rel) === "." ? ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"] : ["CLAUDE.md", "CLAUDE.local.md"];
  for (const n of names) {
    const p = await sandbox.probe(n, dir);
    if (p.state === "ok" && p.real !== doc.file.real) return false;
  }
  return true;
}
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Claude API skill upload rules (platform.claude.com Agent Skills overview): no reserved words, no XML tags. */
const RESERVED_WORDS = ["anthropic", "claude"];
// The overview says only "Cannot contain XML tags" for name and description (read 15 October 2026)
// and does not say what counts. A lone <number> or <file> is how people write a placeholder, and in
// 66 public repos every xml-tag hit of the old pattern was one (Claude Code skills, never sent to
// the API). So only definite markup is reported: a closing tag, a self-closing tag, or a tag with
// an attribute. A lone placeholder the API might still reject is a known miss, noted on the rule page.
const CLOSING_TAG = /<\/([A-Za-z][\w.:-]{0,60})\s{0,8}>/;
const MARKUP_TAG = /<[A-Za-z][\w.:-]{0,60}(?:\s{1,8}[A-Za-z_:][\w.:-]{0,60}\s{0,8}=\s{0,8}(?:"[^"<>\n]{0,200}"|'[^'<>\n]{0,200}'|[^\s"'<>=]{1,200})){1,8}\s{0,8}\/?>|<[A-Za-z][\w.:-]{0,60}\s{0,8}\/>/;

/** The first definite XML or HTML tag in a skill name or description, quoted as written, or null. */
function xmlTag(text: string): string | null {
  const close = CLOSING_TAG.exec(text);
  if (close) {
    // Quote the opening tag when there is one: "<system>" reads better than "</system>".
    const open = new RegExp(`<${close[1]!.replace(/[.]/g, "\\.")}(?:\\s[^<>\\n]{0,200})?>`).exec(text.slice(0, close.index));
    return open ? open[0] : close[0];
  }
  return MARKUP_TAG.exec(text)?.[0] ?? null;
}

/** A valid Agent Skills name close to the given one ("Claude_Deploy" -> "claude-deploy"), or null. */
export function suggestSkillName(name: string): string | null {
  const s = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, VENDOR.skillNameMax)
    .replace(/-+$/, "");
  return s && SKILL_NAME.test(s) && s !== name ? s : null;
}

class Collector {
  readonly issues: Issue[] = [];
  private readonly perRule = new Map<string, number>();
  /** The "more findings" note of each rule that hit its cap; its count is filled in by finish(). */
  private readonly more = new Map<string, Issue>();
  /** True once a rule has hit its cap, so callers can skip building messages; they call skip() instead. */
  full(rule: string): boolean {
    return (this.perRule.get(rule) ?? 0) > CAPS.maxFindingsPerRule;
  }
  add(severity: Severity, rule: string, message: string, line = 1): void {
    const n = this.perRule.get(rule) ?? 0;
    this.perRule.set(rule, n + 1);
    if (n < CAPS.maxFindingsPerRule) this.issues.push({ severity, rule, message, line });
    else if (n === CAPS.maxFindingsPerRule) {
      const note: Issue = { severity: "info", rule, message: "", line };
      this.more.set(rule, note);
      this.issues.push(note);
    }
  }
  /** Counts a finding past the cap without building its message. */
  skip(rule: string): void {
    this.perRule.set(rule, (this.perRule.get(rule) ?? 0) + 1);
  }
  /** Writes the count into each "more findings" note. */
  finish(): void {
    for (const [rule, note] of this.more) {
      const extra = (this.perRule.get(rule) ?? 0) - CAPS.maxFindingsPerRule;
      note.message = `${extra.toLocaleString("en-US")} more ${rule} ${extra === 1 ? "finding" : "findings"} in this file ${extra === 1 ? "was" : "were"} not listed (the first ${CAPS.maxFindingsPerRule} are above); fix those and lint again to see the rest`;
    }
  }
}

/** Edit distance, capped: returns max + 1 as soon as it is clearly larger. Keys are short (at most 60 characters here). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** A known key one or two edits away from an unknown one ("user-invokable" for "user-invocable"), or null. */
function nearestKey(key: string, known: string[]): string | null {
  if (key.length < 4 || key.length > 60) return null;
  const norm = (x: string): string => x.toLowerCase().replace(/_/g, "-");
  const k = norm(key);
  let best: string | null = null;
  let bestD = 3;
  for (const cand of known) {
    const d = editDistance(k, norm(cand), 2);
    if (d < bestD && (d < 2 || cand.length >= 6)) {
      best = cand;
      bestD = d;
    }
  }
  return best;
}

/** A boolean as Claude Code reads one: true/false, or yes, no, on, off, 1, 0 in any case. */
const boolLike = (v: unknown): boolean => typeof v === "boolean" || v === 1 || v === 0 || (typeof v === "string" && /^(?:true|false|yes|no|on|off|1|0)$/i.test(v.trim()));

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The value kind each known frontmatter key takes, where it is fixed. Keys not listed take anything. */
const KEY_TYPE: Record<string, "bool" | "string" | "list" | "map" | "number"> = {
  "disable-model-invocation": "bool", "user-invocable": "bool", background: "bool", alwaysApply: "bool", omitClaudeMd: "bool",
  name: "string", description: "string", when_to_use: "string", "argument-hint": "string", model: "string", effort: "string",
  context: "string", agent: "string", shell: "string", license: "string", compatibility: "string", permissionMode: "string",
  color: "string", initialPrompt: "string", applyTo: "string", mode: "string", trigger: "string", type: "string", isolation: "string",
  "allowed-tools": "list", "disallowed-tools": "list", paths: "list", tools: "list", disallowedTools: "list", globs: "list", skills: "list",
  metadata: "map", hooks: "map", maxTurns: "number",
};

/** Whether a value has the kind the named key takes. A string fits a list key, which also takes one string. */
function valueFits(key: string, v: unknown): boolean {
  const t = KEY_TYPE[key];
  if (!t || v === null || v === undefined) return true;
  switch (t) {
    case "bool":
      return boolLike(v);
    case "string":
      return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
    case "list":
      return typeof v === "string" || Array.isArray(v);
    case "map":
      return typeof v === "object" && !Array.isArray(v);
    case "number":
      return typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v.trim()));
  }
}
const isStrOrList = (v: unknown): boolean => typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"));

function checkFrontmatter(doc: Doc, c: Collector): void {
  const fm = doc.frontmatter;
  for (const p of fm.problems) c.add(p.rule === "frontmatter-bom" || p.rule === "frontmatter-value-cut" ? "warning" : "error", p.rule, p.message, p.line);
  const kind = doc.kind.kind;
  const data = fm.present ? fm.data : null;
  const line = (k: string): number => fm.keyLines[k] ?? 1;

  // A SKILL.md under tests/, fixtures/ or testdata/ is test material: the skill rules below would
  // report fixtures that are wrong on purpose (0.3.0 real-repo review: a test harness skill in
  // pydantic-ai). Frontmatter parse problems above still count, since they break any reader.
  if (kind === "skill" && inTestTree(doc.file.rel)) return;
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
        if (!SKILL_NAME.test(n)) {
          const fix = suggestSkillName(n);
          // Agent Skills spec: "unicode lowercase alphanumeric characters" and hyphens (skills-ref NFKC-normalises).
          // The Claude API and claude.ai accept only a-z, 0-9 and hyphens.
          if (/^[\p{Ll}\p{Lo}\p{Nd}]+(?:-[\p{Ll}\p{Lo}\p{Nd}]+)*$/u.test(n.normalize("NFKC"))) {
            c.add("warning", "name-format", `name ${q(n, 80)} has non-ASCII letters: the Agent Skills spec allows them, but the Claude API and claude.ai accept only a-z, 0-9 and hyphens${fix ? `, for example ${q(fix, 80)}` : ""}`, line("name"));
          } else {
            c.add("error", "name-format", `name ${q(n, 80)} must be lowercase letters, digits and single hyphens (Agent Skills spec; the Claude API and claude.ai allow only a-z, 0-9 and hyphens)${fix ? `, for example ${q(fix, 80)}` : ""}`, line("name"));
          }
        }
        // Only a skill that sits directly in a skills folder is installed under its folder name. A
        // SKILL.md nested inside another skill (a pipeline's stages) and a template folder meant to
        // be copied and renamed are left alone.
        if (dir && dir !== "." && dir !== n && topLevelSkill(doc.file.rel) && !inTemplateFolder(doc.file.rel)) c.add("warning", "name-dir-mismatch", `name ${q(n, 80)} does not match its folder ${q(dir, 80)}; the spec expects them to match, so rename one`, line("name"));
        const reserved = RESERVED_WORDS.find((w) => n.toLowerCase().includes(w));
        if (reserved) {
          // A note: only claude.ai and Claude API uploads reject it; Claude Code, Codex and the other
          // agents that read skills from disk accept the name.
          c.add("info", "name-reserved-word", `name contains the reserved word "${reserved}". Claude Code accepts it, but claude.ai and the Claude API reject a skill whose name contains "anthropic" or "claude", so rename it if you plan to upload this skill`, line("name"));
        }
        const tag = xmlTag(n);
        if (tag) c.add("warning", "xml-tag", `name contains an XML tag ${q(tag, 60)}; the Claude API and claude.ai reject XML tags in a skill name`, line("name"));
      }
      const desc = data["description"];
      if (desc === undefined || desc === null || (typeof desc === "string" && desc.trim() === "")) {
        c.add("error", "missing-description", "description is required: it is what the agent reads to decide when to load the skill (Claude Code uses the first non-empty line of the body instead)", line("description"));
      } else if (typeof desc !== "string") {
        c.add("error", "field-type", "description must be a string", line("description"));
      } else {
        if (desc.length > VENDOR.skillDescriptionMax) {
          c.add("error", "description-too-long", `description is ${desc.length.toLocaleString("en-US")} characters; the Agent Skills spec allows at most ${VENDOR.skillDescriptionMax.toLocaleString("en-US")}, so shorten it`, line("description"));
        }
        const tag = xmlTag(desc);
        if (tag) {
          c.add("warning", "xml-tag", `description contains an XML tag ${q(tag, 60)}. The Claude API and claude.ai reject XML tags in a skill description, and agents can read tags there as instructions`, line("description"));
        }
        const combined = desc.length + (str(data["when_to_use"])?.length ?? 0);
        if (combined > VENDOR.skillListingChars) {
          c.add("warning", "description-truncated", `description plus when_to_use is ${combined} characters; Claude Code truncates the skill listing at ${VENDOR.skillListingChars}, so put the key use case first`, line("description"));
        }
      }
      // Claude Code skills docs: "Boolean fields accept yes, no, on, off, 1, and 0 in any letter case."
      for (const b of ["disable-model-invocation", "user-invocable", "background"]) {
        if (data[b] !== undefined && !boolLike(data[b])) c.add("error", "field-type", `${b} must be true or false (yes, no, on, off, 1 and 0 also work)`, line(b));
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
        c.add("error", "field-type", `alwaysApply must be true or false, not ${typeof data["alwaysApply"] === "string" ? q(data["alwaysApply"], 60) : esc(JSON.stringify(data["alwaysApply"]) ?? "undefined", 60)}`, line("alwaysApply"));
      }
      if (data["globs"] !== undefined && data["globs"] !== null && !isStrOrList(data["globs"])) c.add("error", "field-type", "globs must be a string or a list of strings", line("globs"));
      if (data["alwaysApply"] !== true && !data["globs"] && !data["description"]) {
        c.add("warning", "never-applied", "No alwaysApply, globs or description: Cursor applies this rule only when you @-mention it");
      }
    }
  } else if (kind === "claude-rule") {
    if (data && data["paths"] !== undefined && !isStrOrList(data["paths"])) c.add("error", "field-type", "paths must be a glob string or a list of globs", line("paths"));
  } else if (kind === "copilot-scoped") {
    // VS Code custom instructions docs: without applyTo the file is still found on demand through its
    // description; only with neither is it used just when attached manually.
    if (!data || (!data["applyTo"] && !data["description"])) c.add("warning", "missing-applyTo", "No applyTo and no description in frontmatter, so VS Code uses this file only when you attach it manually. Add applyTo (a glob) or a description");
  } else if (kind === "memory-topic") {
    if (!fm.present && !fm.problems.length) c.add("info", "missing-frontmatter", "Memory topic files usually carry name, description and type frontmatter");
    if (data) {
      const t = data["type"];
      if (t !== undefined && !["user", "feedback", "project", "reference"].includes(String(t))) {
        c.add("warning", "memory-type", `Unknown memory type ${q(String(t), 40)} (expected user, feedback, project or reference)`, line("type"));
      }
      // Not doc-backed (the memory docs document only type and modified), so a note, not a warning.
      if (!str(data["description"])) c.add("info", "missing-description", "No description: Claude Code's own memory files carry one, so the index entry can say when the file matters");
    }
  }

  const known = KNOWN_KEYS[kind];
  if (known && data) {
    for (const k of Object.keys(data)) {
      if (known.keys.includes(k)) continue;
      const near = nearestKey(k, known.keys);
      // A near miss is a typo only when the value is the kind the real key takes: "user_invocable:
      // true" is user-invocable, but a list under "modes:" is custom data, not a misspelt "model:".
      if (near && valueFits(near, data[k])) {
        c.add("warning", "unknown-key", `Frontmatter key ${q(k, 60)} is not read by ${known.reader}; did you mean ${q(near, 60)}? As written it is ignored`, line(k));
      } else if (kind === "skill") {
        // Claude Code skills docs (read 15 October 2026), "Frontmatter reference": claude.ai skill
        // uploads, the Skills API and package_skill.py allow only name, description, license,
        // compatibility, metadata and allowed-tools, and "If you include any field the spec
        // doesn't allow, packaging or upload fails with a hard error". metadata is the spec's
        // free-form map for your own data.
        c.add("info", "unknown-key", `Frontmatter key ${q(k, 60)} is not read by ${known.reader}, so it does nothing there, and claude.ai and the Claude API reject an upload with it; move it under metadata: if it is your own data`, line(k));
      } else {
        c.add("info", "unknown-key", `Frontmatter key ${q(k, 60)} is not read by ${known.reader}, so it does nothing; delete it, or keep it only if your own tooling reads it`, line(k));
      }
    }
  }
}

/**
 * Severity steps for soft vendor targets. These are AsItIs policy, not vendor numbers: the vendor
 * targets are recommendations, and token counts are local estimates. In the 0.3.0 real-repo review
 * (71 repos) every CLAUDE.md between 201 and 250 lines and every SKILL.md body between 5,000 and
 * 6,000 tokens was judged not worth a contributor's time, so those are notes and the warning
 * starts at 300 lines and 6,000 tokens.
 */
const CLAUDE_MD_WARN_LINES = 300;
const SKILL_BODY_WARN_TOKENS = 6000;

function checkLength(doc: Doc, c: Collector, tokens: number): void {
  const kind = doc.kind.kind;
  const lines = doc.profile.lines;
  const bytes = doc.profile.bytes;
  // A CLAUDE.md or AGENTS.md in a template, example or fixture folder, or inside a skill, is not
  // the instruction file of the project being linted: nobody starts Codex in .claude/skills/x/,
  // and examples/app/CLAUDE.md belongs to the sample app.
  const material = notProjectInstructions(doc.file.rel);
  if (kind === "claude-md" && lines > VENDOR.claudeMdTargetLines && !material) {
    const sev = lines > CLAUDE_MD_WARN_LINES ? "warning" : "info";
    c.add(sev, "length", `${lines} lines; Claude Code recommends under ${VENDOR.claudeMdTargetLines} per CLAUDE.md. Move path-specific parts into .claude/rules/ files with paths frontmatter`);
  }
  if (kind === "skill") {
    const longBody = tokens > VENDOR.skillBodyTokens;
    const manyLines = lines > VENDOR.skillMaxLines;
    if (longBody) {
      // One finding per file: a long body is usually long in both tokens and lines.
      const also = manyLines ? ` and ${lines} lines` : "";
      const lineAdvice = manyLines ? ` and Claude Code under ${VENDOR.skillMaxLines} lines` : "";
      c.add(tokens > SKILL_BODY_WARN_TOKENS ? "warning" : "info", "body-tokens", `The SKILL.md body is about ${tokens.toLocaleString("en-US")} tokens${also}; the Agent Skills spec recommends under ${VENDOR.skillBodyTokens.toLocaleString("en-US")} tokens${lineAdvice}, with detail moved to referenced files`);
    } else if (manyLines) {
      c.add("warning", "length", `${lines} lines; keep SKILL.md under ${VENDOR.skillMaxLines} and move detail to referenced files`);
    }
  }
  if (kind === "cursor-rule" && lines > VENDOR.cursorRuleLines) c.add("warning", "length", `${lines} lines; Cursor recommends rules under ${VENDOR.cursorRuleLines} lines`);
  if (kind === "agents-md" && bytes > VENDOR.codexAgentsMdBytes && !material) {
    c.add("warning", "length", `${bytes.toLocaleString("en-US")} bytes; Codex reads at most ${VENDOR.codexAgentsMdBytes.toLocaleString("en-US")} bytes (32 KiB) of AGENTS.md text by default (project_doc_max_bytes), shared by every AGENTS.md from the root down, so the rest is dropped. Nested AGENTS.md files do not help: they share the budget and are dropped first. Shorten it or move detail into docs it links to`);
  }
  if (kind === "windsurf-rule" && doc.text.length > VENDOR.windsurfRuleChars) c.add("warning", "length", `${doc.text.length.toLocaleString("en-US")} characters; Windsurf limits rule files to ${VENDOR.windsurfRuleChars.toLocaleString("en-US")}`);
  if (kind === "memory-index") {
    if (lines > VENDOR.memoryIndexLines) c.add("warning", "length", `${lines} lines; Claude Code loads only the first ${VENDOR.memoryIndexLines} lines of MEMORY.md, so later entries never load`, VENDOR.memoryIndexLines + 1);
    if (bytes > VENDOR.memoryIndexBytes) c.add("warning", "length", `${bytes.toLocaleString("en-US")} bytes; Claude Code loads only the first 25 KB of MEMORY.md`);
  }
  if (doc.kind.load === "every-session" && tokens > 5000) {
    c.add("info", "context-cost", `About ${tokens.toLocaleString("en-US")} tokens load every session, and long steering files are followed less reliably; move topic-specific parts into files that load only when needed (path-scoped rules, skills or linked docs)`);
  }
}

function checkProfile(doc: Doc, c: Collector): void {
  const p = doc.profile;
  if (p.encoding !== "utf-8") c.add("warning", "encoding", `File is ${p.encoding.toUpperCase()}${p.bom ? "" : " without a byte order mark"}; most agent tools expect UTF-8 steering files, so save it as UTF-8`);
  if (p.invalidUtf8.count > 0) {
    const r = p.invalidUtf8.ranges[0]!;
    c.add(
      "warning",
      "invalid-utf8",
      `${p.invalidUtf8.count === 1 ? "1 invalid UTF-8 byte sequence" : `${p.invalidUtf8.count} invalid UTF-8 byte sequences, the first`} at byte ${r.start.toLocaleString("en-US")}. The file may be saved in another encoding, such as Latin-1 or Windows-1252; tools that decode and re-save it will replace ${p.invalidUtf8.count === 1 ? "it" : "them"} with U+FFFD`,
      lineOfByte(doc.file.buf, r.start),
    );
  }
  if (p.nulBytes > 0) c.add("warning", "nul-bytes", `${p.nulBytes === 1 ? "1 NUL byte" : `${p.nulBytes.toLocaleString("en-US")} NUL bytes`}; this may be a binary file`);
  if (p.eol.style === "mixed") c.add("info", "mixed-eol", `Mixed line endings (${p.eol.crlf} CRLF, ${p.eol.lf} LF, ${p.eol.cr} CR). Edit minimal ranges so they stay as they are`);
}

/** scanComments labels for a hidden comment that asks for something harmful, not just one that talks to the AI. */
const DANGEROUS_HIDDEN_LABELS = new Set(["asks to ignore other instructions", "asks to hide something from the user", "asks for covert action", "asks to run a command", "mentions commands or secrets"]);
const hiddenSeverity = (matched: string | null): Severity => (matched !== null && DANGEROUS_HIDDEN_LABELS.has(matched) ? DANGEROUS_HIDDEN_SEVERITY : "warning");

function checkHidden(doc: Doc, c: Collector): void {
  const inv = scanInvisible(doc.lines);
  for (const f of inv.findings) {
    c.add(
      DANGEROUS_HIDDEN_SEVERITY,
      f.bidi ? "bidi-control" : "invisible-char",
      `${f.count === 1 ? "1 invisible character" : `${f.count} invisible characters`}: ${f.codepoints.join(", ")}.${f.bidi ? " Bidirectional controls can make text read differently than it displays." : ""} Agents read these; people do not see them. Delete ${f.count === 1 ? "it" : "them"} unless you put ${f.count === 1 ? "it" : "them"} there on purpose`,
      f.line,
    );
  }
  const com = scanComments(doc.lines, doc.fence);
  let benign = 0;
  let firstBenign = Infinity; // the note points at the first plain comment, HTML or [//]: #
  let firstPreview = "";
  const benignAt = (line: number, preview: string): void => {
    benign++;
    if (line < firstBenign) {
      firstBenign = line;
      firstPreview = preview;
    }
  };
  for (const f of com.findings) {
    if (!f.closed) c.add("warning", "unclosed-comment", `An HTML comment opens here and never closes, so everything after it is hidden in rendered views`, f.line);
    if (f.instructionLike) {
      c.add(hiddenSeverity(f.matched), "hidden-instruction", `Hidden HTML comment ${f.matched}: ${q(f.preview, 80)}. It is invisible when rendered but agents reading the raw file see it. Remove it unless you wrote it`, f.line);
    } else if (f.closed && looksLikeSuppression(f.preview)) {
      // An asitis-disable comment is checked by suppress.ts; counting it as hidden would make every suppression add a note.
    } else {
      benignAt(f.line, f.preview);
    }
  }
  for (const f of scanRefComments(doc.lines, doc.fence)) {
    if (f.instructionLike) {
      c.add(hiddenSeverity(f.matched), "hidden-instruction", `Hidden link-reference comment ([//]: # style) ${f.matched}: ${q(f.preview, 80)}. It renders as nothing but agents reading the raw file see it. Remove it unless you wrote it`, f.line);
    } else {
      benignAt(f.line, f.preview);
    }
  }
  const benignTotal = benign + Math.max(0, com.total - com.findings.length);
  if (benignTotal > 0) {
    // Claude Code memory docs (read 15 October 2026): block-level HTML comments in CLAUDE.md are
    // stripped before the content is injected, and the docs suggest them for notes to maintainers.
    const one = benignTotal === 1;
    const where = doc.kind.kind === "claude-md"
      ? `Claude Code strips ${one ? "it" : "them"} from CLAUDE.md at session start, though its Read tool and other agents still see ${one ? "it" : "them"}`
      : `agents reading the raw file see ${one ? "it" : "them"}, people reading the rendered file do not`;
    const what = firstPreview ? `${one ? "" : ", the first"} on line ${firstBenign}: ${q(firstPreview, 60)}` : "";
    const count = one ? "1 comment (HTML or [//]: # style) is" : `${benignTotal} comments (HTML or [//]: # style) are`;
    c.add("info", "hidden-comment", `${count} hidden in rendered views${what}. ${one ? "It does not read" : "None reads"} like an instruction to an agent; ${where}, so check that ${one ? "it says" : "they say"} what you expect`, Number.isFinite(firstBenign) ? firstBenign : 1);
  }
  for (const line of scanHiddenStyles(doc.lines, doc.fence)) c.add("warning", "hidden-styled-text", "Inline style or the hidden attribute hides text (display:none, zero size, zero opacity, white text or <div hidden>)", line);
}

/** One rule candidate: a whole list item or a whole paragraph, with wrapped lines joined (issue #3). */
interface Block {
  text: string; // joined with single spaces
  lineAt: number[]; // offset in `text` where each source line starts
  firstLine: number; // 0-based
  listItem: boolean;
  nested: boolean; // the list item is indented under another
  ordered: boolean; // a numbered list item
  section: number;
  path: SectionPath;
}

/** One level of the headings and labels a rule sits under. */
export interface SectionStep {
  /** 1 to 6 for headings, 7 for a label line ("**Regular posts**:"), 8 for a paragraph's bold lead-in. */
  level: number;
  /** Lowercased words of the heading or label, markup and punctuation removed. */
  title: string;
  /** 0-based line of the heading or label, so two headings with the same text stay apart. */
  line: number;
}
export type SectionPath = readonly SectionStep[];

/** Heading or label text for comparing sections: case, markup and punctuation removed. */
function sectionTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(HTML_TAG, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A paragraph that opens with a bold lead-in ("**Round 1 (always)** - batch five questions"). */
const BOLD_LEAD = /^\*\*([^*\n]{1,80})\*\*\s{0,4}(?:[:\u2013\u2014(-]|$)/;

const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
/** Thematic breaks and setext underlines: ---, ***, ___, ===. */
const RULE_LINE = /^ {0,3}(?:[-*_=] *){3,}$/;
/** Lines that are only HTML tags (`</details>`, `<summary>Example</summary>` is not: it has text). */
const MARKUP_ONLY = /^\s*(?:<\/?[A-Za-z][\w.:-]{0,60}(?:\s[^<>\n]{0,300})?\/?>\s*){1,12}$/;
const MAX_BLOCK_CHARS = 2000;
/** An HTML tag inside a rule ("<summary>Example</summary>" compares as "example"). */
const HTML_TAG = /<\/?[A-Za-z][\w.:-]{0,60}(?:\s[^<>\n]{0,300})?\/?>/g;

/** Splits a joined block at sentence ends (". " before a capital, digit, quote or markup), keeping start offsets. */
function sentences(text: string): Array<{ at: number; text: string }> {
  const out: Array<{ at: number; text: string }> = [];
  let from = 0;
  for (let i = 0; i < text.length - 2; i++) {
    const ch = text.charCodeAt(i);
    if ((ch !== 46 && ch !== 33 && ch !== 63) || text.charCodeAt(i + 1) !== 32) continue;
    const next = text[i + 2]!;
    if (!/[A-Z0-9`*_"'([]/.test(next)) continue;
    // "e.g. Foo", "i.e. Bar", "vs. Baz": a lowercase one- or two-letter word before the dot is an abbreviation.
    if (ch === 46 && /(?:^|[\s(.])(?:[a-z]{1,2}|etc|vs)$/.test(text.slice(Math.max(from, i - 4), i))) continue;
    out.push({ at: from, text: text.slice(from, i + 1) });
    from = i + 2;
  }
  out.push({ at: from, text: text.slice(from) });
  return out;
}

/** The rule as written, without its list marker or closing punctuation, for quoting in a message. */
function rulePreview(s: string): string {
  return trimEndChars(s.replace(LIST_MARKER, "").trim(), ".!;:, ");
}

function normRule(s: string): string {
  return trimEndChars(
    s
      .toLowerCase()
      .replace(LIST_MARKER, "")
      .replace(HTML_TAG, " ")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      // "A cohesive palette" and "Cohesive palette" are the same rule.
      .replace(/^(?:a|an|the) /, ""),
    ".!;:, ",
  );
}

/**
 * Verbs that start an instruction ("Run `pnpm test` before every commit", "Keep PRs small").
 * Words that often start a label instead ("Commit messages", "Release notes", "Test coverage",
 * "Open questions", "Build output") are left out on purpose; a short item that starts with one
 * of those still counts as a rule when it says always, never, must or should, or holds a command.
 */
const IMPERATIVE = new Set(
  (
    "use run keep prefer avoid add write follow check make ensure put include remove delete update read create push install " +
    "wrap pass ask verify validate handle define declare mark prefix leave let stop skip ignore treat consider split move rename " +
    "reuse replace extract cite explain describe mention fix refactor rebase squash sign bump pin lock sort throw raise await wait " +
    "rerun regenerate compile restart reset edit modify configure enable disable set favor favour stick stay prefer double-check " +
    "re-run look search grep execute invoke apply append insert rewrite review confirm keep"
  ).split(" "),
);
const MODAL = /\b(?:always|never|don'?t|do not|must|mustn'?t|should|shouldn'?t)\b/;
/** An inline code span that holds a command: a known tool followed by arguments, or ./script. */
const CODE_COMMAND = /`(?:\.\/[\w.-]+|(?:npm|pnpm|yarn|npx|bun|bunx|git|make|cargo|go|python3?|pip3?|uv|uvx|poetry|docker|just|deno|node|pytest|tox|gradlew?|\.\/gradlew|mvn|dotnet|bazel|rake|bundle|composer|mix|swift|xcodebuild|turbo|nx|ruff|mypy|tsc|eslint|prettier|vitest|jest|rustup|kubectl|helm|terraform)\s[^`]+)`/;

/** Whether a short list item reads as an instruction rather than a label such as "Quality checklist". */
export function readsAsRule(text: string): boolean {
  const t = text.replace(LIST_MARKER, "").replace(/[*_]/g, "").trim();
  const lower = t.toLowerCase();
  const first = /^[a-z][a-z-]*/.exec(lower)?.[0] ?? "";
  if (IMPERATIVE.has(first) && /\s\S/.test(t) && !/^use cases?\b/.test(lower)) return true;
  if (MODAL.test(lower)) return true;
  return CODE_COMMAND.test(t);
}

/** Section headings and parent bullets that list things to avoid ("## Don'ts", "- Avoid:"): their items are written positively but mean "do not". */
const NEGATIVE_CONTEXT = /\b(?:don'?ts?|do not|avoid|never|not allowed|anti-?patterns?|bad|wrong|forbidden|prohibited|banned|mistakes?|pitfalls?)\b|\u274c|\u{1f6ab}|\u26d4/iu;

/** Rule text for the contradiction check: case, markup, backticks and punctuation removed, contractions expanded. */
function contraNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(LIST_MARKER, "")
    .replace(HTML_TAG, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bdon'?t\b/g, "do not")
    .replace(/\bmustn'?t\b/g, "must not")
    .replace(/\bshouldn'?t\b/g, "should not")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
/** "Prefer X" against "Avoid X" is its own pair: neither is the plain opposite of "Use X" or "Never X". */
const PREFER_RULE = /^(?:please )?(?:always )?(?:prefer|favou?r) (.+)$/;
const AVOID_RULE = /^(?:please )?(?:always )?avoid (.+)$/;
const NEG_RULE = /^(?:please )?(?:you )?(?:never|do not|must not|must never|should not|should never)(?: ever)? (.+)$/;
const POS_RULE = /^(?:please )?(?:you )?(?:always|must always|must|should always|should|do)(?: always)? (.+)$/;

/** Splits a rule into its polarity and the action it is about, or null when it is not a do or do-not rule. */
function polarity(text: string, negativeContext: boolean): { neg: boolean; core: string; explicit: boolean } | null {
  const norm = contraNorm(text);
  const avoid = AVOID_RULE.exec(norm);
  if (avoid) return { neg: true, core: `prefer: ${avoid[1]!}`, explicit: true };
  const prefer = PREFER_RULE.exec(norm);
  if (prefer) return negativeContext ? null : { neg: false, core: `prefer: ${prefer[1]!}`, explicit: true };
  const n = NEG_RULE.exec(norm);
  if (n) return { neg: true, core: n[1]!, explicit: true };
  const p = POS_RULE.exec(norm);
  if (p) return { neg: false, core: p[1]!, explicit: true };
  // A bare imperative ("Use named exports") is a "do" rule, unless it sits under a list of things to avoid.
  const first = /^[a-z][a-z-]*/.exec(norm)?.[0] ?? "";
  if (!negativeContext && IMPERATIVE.has(first) && norm.includes(" ")) return { neg: false, core: norm, explicit: false };
  return null;
}

/** One rule candidate found by forEachRule: a list item, or one sentence of a paragraph. */
export interface RuleUnit {
  /** 1-based line where the rule starts. */
  line: number;
  /** Normalised text used to compare rules (case, markup and closing punctuation removed). */
  norm: string;
  /** The rule as written, for quoting in a message. */
  preview: string;
  /** Reads as an instruction (imperative verb, always/never/must/should, or a command). */
  rule: boolean;
  /** Do or do-not polarity and the action it is about, after the list-of-things-to-avoid context is applied. */
  pol: { neg: boolean; core: string; explicit: boolean } | null;
  section: number;
  listItem: boolean;
  nested: boolean;
  /** Normalised parent bullet for nested list items, else "". */
  parent: string;
  /** Headings and labels above the rule, outermost first. */
  path: SectionPath;
  /** Counts the list items and paragraphs of the file; units of one paragraph share it. */
  block: number;
  /** A numbered list item. */
  ordered: boolean;
}

/**
 * Walks the rule candidates of a file in order. A rule is a whole list item or a sentence of a
 * paragraph, with wrapped lines joined first, so the continuation lines of two different
 * sentences ("the contribution guide.") never match. Markup-only lines (`</details>`), headings,
 * tables, comments, thematic breaks, bold labels and short labels are not rules. Used by the
 * per-file duplicate and contradiction checks and by the cross-file drift checks.
 */
export function forEachRule(doc: Doc, visit: (u: RuleUnit) => void): void {
  const start = doc.frontmatter.present ? doc.frontmatter.endLine + 1 : 0;
  let section = 0;
  let negSection = false;
  let parent = ""; // the last top-level list item, for nested items
  let lead = false; // the paragraph before this list introduces things to avoid ("Avoid these:")
  let block: Block | null = null;
  let blocks = 0;
  // Headings above the current line, the bold label line ("**Apple fields:**") under the last
  // one, and a plain label line ("Summary shown first:") that names only the list right after it.
  let heads: SectionStep[] = [];
  let boldLabel: SectionStep | null = null;
  let colonLabel: SectionStep | null = null;
  let curPath: SectionPath = [];
  const setPath = (): void => {
    curPath = [...heads, ...(boldLabel ? [boldLabel] : []), ...(colonLabel ? [colonLabel] : [])];
  };
  // Steering files repeat lines; a hostile one repeats a pair 100,000 times. Each distinct text
  // is analysed once (bounded cache).
  type Facts = { norm: string; rule: boolean; pos: ReturnType<typeof polarity> };
  const analysed = new Map<string, Facts>();
  const analyse = (text: string): Facts => {
    let a = analysed.get(text);
    if (!a) {
      a = { norm: normRule(text), rule: readsAsRule(text), pos: polarity(text, false) };
      if (analysed.size < 50_000) analysed.set(text, a);
    }
    return a;
  };

  const flush = (): void => {
    const b = block;
    block = null;
    if (!b) return;
    const id = blocks++;
    if (b.listItem && !b.nested) parent = b.text;
    if (!b.listItem) lead = NEGATIVE_CONTEXT.test(b.text) && /:[*_\s]*$/.test(b.text);
    const negativeContext = negSection || (b.listItem && lead) || (b.nested && NEGATIVE_CONTEXT.test(parent));
    // A label line names what follows it, the way a heading names a section, so parallel lists stay
    // apart: a bold label ("**Regular posts**:", or a bold first line of a paragraph) holds until
    // the next heading or label, a plain one ("**@scope/ui** sub-path exports:") only for the list
    // right after it.
    if (!b.listItem) {
      const firstLine = b.lineAt.length > 1 ? b.text.slice(0, b.lineAt[1]! - 1) : b.text;
      const bold = firstLine.length <= 120 && BOLD_LABEL.test(firstLine);
      colonLabel = null;
      if (bold) {
        boldLabel = { level: 7, title: sectionTitle(firstLine), line: b.firstLine };
      } else if (b.lineAt.length === 1 && b.text.length <= 120 && /:[*_\s]*$/.test(b.text)) {
        colonLabel = { level: 7, title: sectionTitle(b.text), line: b.firstLine };
      }
      setPath();
    }
    if (b.lineAt.length === 1 && BOLD_LABEL.test(b.text)) return;
    // A paragraph with a bold lead-in ("**Round 1** - ask five questions") is its own sub-section.
    const base = b.listItem ? b.path : curPath;
    const leadIn = b.listItem ? null : BOLD_LEAD.exec(b.text);
    const path: SectionPath = leadIn ? [...base, { level: 8, title: sectionTitle(leadIn[1]!), line: b.firstLine }] : base;
    // Sentences come in order, so one forward pointer maps offsets to lines.
    let k = 0;
    const lineOf = (at: number): number => {
      while (k + 1 < b.lineAt.length && b.lineAt[k + 1]! <= at) k++;
      return b.firstLine + k + 1;
    };
    // A list item is one rule; a paragraph is a run of sentences.
    const parts = b.listItem ? [{ at: 0, text: b.text }] : sentences(b.text);
    for (const part of parts) {
      const facts = analyse(part.text);
      const norm = facts.norm;
      if (norm.startsWith("#") || norm.startsWith("|") || norm.startsWith("<!--")) continue;
      // A short label that introduces a list or code ("Code comments:", "Run tests:") is not a rule.
      if (norm.length < 40 && part.text.replace(/[*_`\s]+$/, "").endsWith(":")) continue;
      const words = norm.split(" ").length;
      const rule = facts.rule;
      // Very short text is a rule only when it reads as one ("Use pnpm", "Never use tabs").
      if (norm.length < 12 && !(rule && words >= 2)) continue;
      // A sentence taken out of a longer paragraph needs four words to be a rule:
      // emphasis such as "No exceptions." or "Every single time." repeats by design.
      if (parts.length > 1 && words < 4) continue;
      // Under a list of things to avoid, polarity() drops a bare imperative ("Use X") and "Prefer X"; the rest stands.
      const p0 = facts.pos;
      const pol = negativeContext && p0 && !p0.neg && (!p0.explicit || p0.core.startsWith("prefer: ")) ? null : p0;
      visit({
        line: lineOf(part.at),
        norm,
        preview: rulePreview(part.text),
        rule,
        pol,
        section: b.section,
        listItem: b.listItem,
        nested: b.nested,
        parent: b.listItem && b.nested ? normRule(parent) : "",
        path,
        block: id,
        ordered: b.ordered,
      });
    }
  };

  for (let i = start; i < doc.lines.count; i++) {
    if (doc.fence[i]) { flush(); continue; }
    const len = doc.lines.end(i) - doc.lines.start(i);
    if (len > MAX_BLOCK_CHARS) { flush(); continue; } // too long to compare; it ends the block it belongs to
    const raw = doc.lines.line(i);
    const trimmed = raw.trim();
    if (HEADING.test(raw)) {
      flush();
      section = i;
      const level = /^ {0,3}(#{1,6})/.exec(raw)![1]!.length;
      while (heads.length && heads[heads.length - 1]!.level >= level) heads.pop();
      heads = [...heads, { level, title: sectionTitle(trimmed.replace(/^#{1,6}/, "").replace(/#+\s*$/, "")), line: i }];
      boldLabel = null;
      colonLabel = null;
      setPath();
      negSection = NEGATIVE_CONTEXT.test(trimmed);
      parent = "";
      lead = false;
      continue;
    }
    if (!trimmed || RULE_LINE.test(raw) || MARKUP_ONLY.test(raw) || trimmed.startsWith("|") || trimmed.startsWith("<!--")) { flush(); continue; }
    const marker = LIST_MARKER.exec(raw);
    if (marker || !block) {
      flush();
      if (!marker) parent = "";
      const text = trimmed.replace(/\s+/g, " ");
      block = { text, lineAt: [0], firstLine: i, listItem: !!marker, nested: !!marker && /^\s+/.test(raw), ordered: !!marker && /^\s*\d/.test(raw), section, path: curPath };
      continue;
    }
    // A wrapped continuation line of the current list item or paragraph.
    const b: Block = block;
    if (b.text.length + 1 + trimmed.length > MAX_BLOCK_CHARS) {
      // A very long paragraph is compared in pieces, which keeps the work per block bounded.
      flush();
      block = { text: trimmed.replace(/\s+/g, " "), lineAt: [0], firstLine: i, listItem: false, nested: false, ordered: false, section, path: curPath };
      continue;
    }
    b.lineAt.push(b.text.length + 1);
    b.text += " " + trimmed.replace(/\s+/g, " ");
  }
  flush();
}

/** Words that do not make two headings related ("Add a feature" and "Fix the build" share none). */
const TITLE_STOP = new Set("a an the of for to in on at by as is are be and or if not no with from into this that these those your you it its via vs".split(" "));

/** The words of a heading that carry meaning, for telling parallel sibling sections apart from unrelated ones. */
function titleWords(title: string): string[] {
  return title.split(" ").filter((w) => w.length >= 3 && !TITLE_STOP.has(w) && !/^\d+$/.test(w));
}

type DupKind = "same-section" | "copied" | "elsewhere";

/**
 * How the sections of two copies of a rule relate. "same" when they sit in one section; "parallel"
 * when they are sibling sections of one shape (Regular posts / Video posts, Phase 1: Scan / Phase 3:
 * Issue, If using artifacts / If using a file), where shared steps are the point; else "other".
 */
function sectionRelation(a: SectionPath, b: SectionPath): "same" | "same-topic" | "parallel" | "other" {
  const n = Math.min(a.length, b.length);
  let d = 0;
  while (d < n && a[d]!.line === b[d]!.line) d++;
  if (d === a.length && d === b.length) return "same";
  if (d === n) return "other"; // one section holds the other: a summary and its detail
  const ta = a[d]!.title;
  const tb = b[d]!.title;
  // The same heading twice, or one inside the other ("Session Completion" in "Landing the Plane
  // (Session Completion)"), is one topic written twice.
  if (ta === tb || (ta.length >= 4 && tb.length >= 4 && (ta.includes(tb) || tb.includes(ta)))) return "same-topic";
  const wa = new Set(titleWords(ta));
  return titleWords(tb).some((w) => wa.has(w)) ? "parallel" : "other";
}

/** A template line whose words are mostly placeholders ("- [Finding from Phase 1] -> [explains this choice]", "> [Example]"). */
function placeholderOnly(text: string): boolean {
  if (!text.includes("[")) return false;
  const rest = text.replace(/\[[^\]\n]{1,80}\](?![(\[:])/g, " ").replace(LIST_MARKER, "");
  if (rest.length === text.length) return false;
  return (rest.match(/[\p{L}\p{N}]{2,}/gu) ?? []).length < 4;
}

function checkRules(doc: Doc, c: Collector): void {
  // Heuristics: duplicate rules, and "do X" against "do not X".
  // Noise control: bold labels ("**Instructions:**") and short labels ("Code comments:")
  // repeat by design, and a short list item repeated under another heading or parent
  // bullet is structure ("- Quality checklist"), unless it reads as an instruction
  // ("- Run `pnpm test` before every commit"), which is exactly what steering files repeat by mistake.
  //
  // Where the two copies sit decides what is reported (0.3.0 real-repo review, 93 duplicate-rule
  // warnings in 71 repos, 10% worth fixing):
  // - one section: a warning, the copy is almost always a mistake;
  // - a block copied from a section with the same heading (the rules before or after it repeat too): a warning;
  // - parallel sibling sections (two procedures, two variants) share steps on purpose: nothing;
  // - any other two sections, such as a summary and its detail: a note.
  // A paragraph gives at most one finding, and an AGENTS.md that is skill or template material is
  // not checked for duplicates (it is reference text, not instructions loaded into a session).
  const units: RuleUnit[] = [];
  forEachRule(doc, (u) => void units.push(u));
  const checkDups = !(doc.kind.kind === "agents-md" && notProjectInstructions(doc.file.rel));
  const firstOf = new Int32Array(units.length).fill(-1);
  if (checkDups) {
    const seen = new Map<string, number>();
    units.forEach((u, j) => {
      const f = seen.get(u.norm);
      if (f === undefined) seen.set(u.norm, j);
      else firstOf[j] = f;
    });
  }
  const copied = (j: number): boolean => {
    const f = firstOf[j]!;
    return (j > 0 && f > 0 && firstOf[j - 1] === f - 1) || (j + 1 < units.length && firstOf[j + 1]! >= 0 && firstOf[j + 1] === f + 1);
  };
  // The finding for each paragraph or list item: the strongest of its sentences.
  const best = new Map<number, { j: number; kind: DupKind }>();
  const rank: Record<DupKind, number> = { "same-section": 2, copied: 2, elsewhere: 1 };
  for (let j = 0; j < units.length; j++) {
    const f = firstOf[j]!;
    if (f < 0) continue;
    const u = units[j]!;
    const first = units[f]!;
    const rule = u.rule;
    // Short list items that are labels ("- Quality checklist") repeat as structure under another
    // heading or parent bullet. A short sub-item under a different parent bullet ("Feature PRs:" /
    // "Bugfix PRs:" each with "- Add a changelog entry") is a per-parent checklist, even when it is an instruction.
    const rel = sectionRelation(first.path, u.path);
    const structural = u.listItem && u.norm.length < 40 && ((!rule && (rel !== "same" || u.nested)) || (u.nested && first.parent !== u.parent));
    if (structural || placeholderOnly(u.preview) || rel === "parallel") continue;
    const kind: DupKind = rel === "same" ? "same-section" : rel === "same-topic" && copied(j) ? "copied" : "elsewhere";
    const prev = best.get(u.block);
    if (!prev || rank[kind] > rank[prev.kind]) best.set(u.block, { j, kind });
  }
  for (const { j, kind } of [...best.values()].sort((x, y) => x.j - y.j)) {
    if (c.full("duplicate-rule")) {
      c.skip("duplicate-rule");
      continue;
    }
    const u = units[j]!;
    const first = units[firstOf[j]!]!;
    const quote = q(u.preview, 60);
    if (kind === "same-section") {
      c.add("warning", "duplicate-rule", `Same rule as line ${first.line}: ${quote}. Duplicates cost context and drift apart when one is edited; keep one`, u.line);
    } else if (kind === "copied") {
      c.add("warning", "duplicate-rule", `Same rule as line ${first.line}, in a block of text that repeats from there: ${quote}. Duplicates cost context and drift apart when one is edited; keep one copy`, u.line);
    } else {
      c.add("info", "duplicate-rule", `Same rule as line ${first.line}, under another heading: ${quote}. If one section summarises the other, or they never apply together, this can be on purpose; otherwise keep one`, u.line);
    }
  }

  const pos = new Map<string, { line: number; text: string }>();
  const neg = new Map<string, { line: number; text: string }>();
  for (const u of units) {
    const pol = u.pol;
    if (!pol || pol.core.length < 4) continue;
    const mine = pol.neg ? neg : pos;
    const other = (pol.neg ? pos : neg).get(pol.core);
    if (other !== undefined) {
      if (c.full("contradiction")) c.skip("contradiction");
      else c.add("warning", "contradiction", `Contradicts line ${other.line}: line ${other.line} says ${q(other.text, 60)} and line ${u.line} says ${q(u.preview, 60)}. Keep the one you mean`, u.line);
    }
    if (!mine.has(pol.core)) mine.set(pol.core, { line: u.line, text: u.preview });
  }
}

/** A line that is only a bold label, such as "**Instructions to user:**" or "- __Note__". Bounded by the line cap. */
const BOLD_LABEL = /^\s*(?:[-*+]\s+)?(?:\*\*[^*\n]{1,120}\*\*|__[^_\n]{1,120}__)\s*:?\s*$/;

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

/** Emoji variation selectors (U+FE00 to U+FE0F): GitHub keeps U+FE0F in anchors, VS Code and most other renderers drop it. */
const stripSelectors = (s: string): string => s.replace(/[\uFE00-\uFE0F]/g, "");

/** GitHub-style heading anchors: lowercase, punctuation dropped, spaces to hyphens. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Every anchor a renderer could give this file: each heading's slug (with the -1, -2 suffixes
 * GitHub adds to repeats, and with and without emphasis underscores), explicit {#id} heading
 * ids, and id= or name= attributes in HTML. Matching is case-insensitive.
 */
function anchorsOf(doc: Doc): Set<string> {
  const out = new Set<string>();
  const counts = new Map<string, number>();
  const add = (a: string): void => {
    if (!a) return;
    const n = counts.get(a) ?? 0;
    counts.set(a, n + 1);
    out.add(a);
    out.add(`${a}-${n}`);
    out.add(`${a}-${n + 1}`);
  };
  for (const h of outline(doc.lines, doc.fence, doc.frontmatter.present ? doc.frontmatter.endLine : -1).headings) {
    const custom = /\{#([^}\s]{1,200})\}\s*$/.exec(h.text);
    if (custom) out.add(custom[1]!.toLowerCase());
    const text = h.text
      .replace(/\{#[^}]*\}\s*$/, "")
      .replace(/!?\[([^\]]{0,300})\]\([^)]{0,500}\)/g, "$1")
      .replace(HTML_TAG, "")
      .replace(/[`*~]/g, "")
      .trim();
    add(slug(text));
    add(slug(text.replace(/_/g, "")));
    if (stripSelectors(text) !== text) add(slug(stripSelectors(text)));
  }
  for (let i = 0; i < doc.lines.count; i++) {
    if (doc.fence[i]) continue;
    const line = doc.lines.line(i);
    if (line.length > 4000 || (!line.includes("id=") && !line.includes("name="))) continue;
    for (const m of line.matchAll(/\b(?:id|name)\s*=\s*["']([^"'\s]{1,200})["']/g)) out.add(m[1]!.toLowerCase());
  }
  return out;
}

const MARKDOWN_TARGET = /\.(?:md|markdown|mdx|mdc)$/i;

/** Files people link to that have no extension. */
const EXTENSIONLESS_FILE = /^(?:Makefile|GNUmakefile|Dockerfile|Containerfile|Justfile|justfile|Gemfile|Rakefile|Procfile|Brewfile|Vagrantfile|Jenkinsfile|Caddyfile|Taskfile|LICENSE|LICENCE|COPYING|NOTICE|AUTHORS|CODEOWNERS|README|CHANGELOG|CONTRIBUTING|SECURITY|VERSION)$/;

/** Submodule folders from the root .gitmodules, read once per sandbox. Empty when there is none or it cannot be read. */
const submoduleCache = new WeakMap<Sandbox, Promise<string[]>>();
function submodulesOf(sandbox: Sandbox): Promise<string[]> {
  let p = submoduleCache.get(sandbox);
  if (!p) {
    p = (async () => {
      const probe = await sandbox.probe(GITMODULES_FILE, sandbox.primary.real);
      if (probe.state !== "ok") return [];
      try {
        const f = await sandbox.openAs("gitmodules", GITMODULES_FILE);
        return submodulePaths(new TextDecoder("utf-8").decode(f.buf));
      } catch {
        return [];
      }
    })();
    submoduleCache.set(sandbox, p);
  }
  return p;
}

async function checkLinks(doc: Doc, sandbox: Sandbox, c: Collector): Promise<void> {
  const dir = path.dirname(doc.file.real);
  const links = extractLinks(doc.lines, doc.fence);
  const cache = new Map<string, { state: string; real?: string }>();
  const anchorCache = new Map<string, Set<string> | null>();
  let own: Set<string> | null = null;
  const missingAnchor = (anchors: Set<string>, frag: string): boolean => {
    const f = safeDecode(frag).toLowerCase();
    // Line anchors (#L10) and #top are provided by the renderer, not by headings.
    if (!f || f === "top" || /^l\d+(?:-l\d+)?$/.test(f)) return false;
    return !anchors.has(f) && !anchors.has(stripSelectors(f));
  };
  for (const l of links) {
    if (l.target.startsWith("#")) {
      own ??= anchorsOf(doc);
      if (missingAnchor(own, l.target.slice(1))) {
        c.add("warning", "broken-link", `No heading in this file has the anchor ${q(l.target, 200)}. Fix the link or the heading it points to`, l.line);
      }
      continue;
    }
    if (isExternalTarget(l.target)) continue;
    // Placeholders in examples and templates: [Title](URL), [run](${GITHUB_SERVER_URL}/...), [x]({{ link }}), [x](<path>).
    if (/\$\{|\{\{|^<.*>$/.test(l.target) || /^[A-Z][A-Z0-9_]*$/.test(l.target)) continue;
    // A single word with no dot or slash ("[Smith et al., 2025](url)", "[docs](link)") is a
    // placeholder far more often than a file, unless it is a well-known file without an extension.
    if (/^[\w-]{1,40}$/.test(l.target) && !EXTENSIONLESS_FILE.test(l.target)) continue;
    let t = l.target;
    const h = t.search(/[#?]/);
    const frag = h >= 0 && t[h] === "#" ? t.slice(h + 1) : "";
    if (h >= 0) t = t.slice(0, h);
    if (!t) continue;
    t = safeDecode(t);
    if (t.startsWith("/")) continue; // site-absolute paths depend on the renderer
    let probe = cache.get(t);
    if (!probe) {
      const p = await sandbox.probe(t, dir);
      probe = { state: p.state, ...(p.real ? { real: p.real } : {}) };
      cache.set(t, probe);
    }
    const state = probe.state;
    if (state === "missing") {
      const fromRoot = path.posix.normalize(path.posix.join(path.posix.dirname(doc.file.rel), t.replace(/\\/g, "/")));
      // A link into a git submodule that is not checked out: a plain clone leaves the folder empty.
      const subs = await submodulesOf(sandbox);
      if (subs.some((m) => fromRoot === m || fromRoot.startsWith(m + "/"))) continue;
      // Written from the repository root instead of from this file ("docs/x.md" in .cursor/rules/a.mdc):
      // an agent working from the root finds it, editors and Markdown viewers do not.
      if (!/^\.\.?\//.test(t) && path.posix.dirname(doc.file.rel) !== ".") {
        const rootProbe = await sandbox.probe(t, sandbox.primary.real);
        if (rootProbe.state === "ok") {
          c.add("info", "broken-link", `${q(l.target, 200)} is not found next to this file but exists from the repository root; agents working from the root find it, but editors and Markdown viewers do not, so write it relative to this file`, l.line);
          continue;
        }
      }
      c.add("warning", "broken-link", `Relative link target not found: ${q(l.target, 200)}. Fix the path or remove the link`, l.line);
    }
    else if (state === "outside") c.add("info", "link-outside-root", `Link points outside the allowed folder and was not checked: ${q(l.target, 200)}`, l.line);
    else if (frag && probe.real && MARKDOWN_TARGET.test(t)) {
      let anchors = anchorCache.get(probe.real);
      if (anchors === undefined) {
        try {
          const f = await sandbox.open(probe.real);
          anchors = anchorsOf(analyse(f, sandbox.displayFile(f)));
        } catch {
          anchors = null; // unreadable or refused: not checked
        }
        anchorCache.set(probe.real, anchors);
      }
      if (anchors && missingAnchor(anchors, frag)) {
        c.add("warning", "broken-link", `${q(t, 200)} exists, but no heading in it has the anchor ${q("#" + frag, 200)}. Fix the link or the heading it points to`, l.line);
      }
    }
  }
  if (!IMPORT_KINDS.includes(doc.kind.kind) && !(doc.kind.kind === "agents-md" && (await claudeReadsAgentsMd(doc, sandbox)))) return;
  const imports = extractImports(doc.lines, doc.fence, doc.frontmatter.present ? doc.frontmatter.endLine : -1);
  // AGENTS.md is also read by Codex and others, where @ is plain text (@user, @next/rspack-core,
  // @transaction()). There, only an @path naming a file with an extension is treated as an import.
  const agents = doc.kind.kind === "agents-md";
  for (const im of imports) {
    if (agents && !(importIsSurelyFile(im) && /\.[A-Za-z0-9]{1,10}$/.test(im.path))) continue;
    if (im.path.startsWith("~")) {
      c.add("warning", "import-outside-root", `${q("@" + im.path, 200)} imports from your home folder. Claude Code asks for approval of external imports; teammates will not have this file`, im.line);
      continue;
    }
    const probe = await sandbox.probe(im.path, dir);
    if (probe.state === "missing") {
      // @scope/package (an npm name: one slash, no file extension, not ./ or ../) is far more often a package than a file.
      const sure = importIsSurelyFile(im);
      // A heading such as "# @cypress/angular" names the package the file is about.
      if (!sure && HEADING.test(doc.lines.line(im.line - 1))) continue;
      const npmName = im.looksLikePath && !sure;
      c.add(
        sure ? "warning" : "info",
        "broken-import",
        `${q("@" + im.path, 200)} is read as an import but the file does not exist${sure ? ". Fix the path or remove the line" : npmName ? ". If this is an npm package name, not a file, wrap it in backticks" : ". If this is not a file, wrap it in backticks"}`,
        im.line,
      );
    } else if (probe.state === "outside") {
      c.add("warning", "import-outside-root", `${q("@" + im.path, 200)} resolves outside the allowed folder; Claude Code shows an approval dialog for external imports`, im.line);
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
  c.issues.push(...hygieneIssues(doc)); // trailing-whitespace and final-newline (WP7), at most one each
  checkHidden(doc, c);
  checkRules(doc, c);
  await checkLinks(doc, sandbox, c);
  if (hasUnsafe(doc.path)) {
    c.add("warning", "unsafe-path", `The path ${q(doc.path, 200)} contains control, bidirectional or invisible characters (shown escaped). They can make a name read differently to people and to agents`);
  }
  c.finish();
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  c.issues.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
  return { path: doc.path, kind: doc.kind.kind, load: doc.kind.load, tokens, issues: c.issues };
}
