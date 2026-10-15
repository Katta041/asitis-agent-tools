// Skill folder security scan (F8). Owner: WP5. Opt-in: include "skills".
//
// For every SKILL.md the lint read, this walks the skill's folder with sandbox.listDir and reads
// files through the skill-script read class (policy/skill-script.ts): scripts in full (at most 1 MB),
// everything else for its first 4 bytes only. Markdown in the folder (references, README.md) is read
// through the normal markdown class. Nothing is executed and no file content is returned: messages
// quote at most 80 characters, redacted (scan-script.ts).
//
// It also checks the frontmatter and body of skills and Claude Code commands (allowed-tools,
// arguments inside !`...` commands) and subagents (no tools list, bypassPermissions).
// Sources, read 14 October 2026:
// - Claude Code skills docs (https://code.claude.com/docs/en/skills): allowed-tools "grants permission
//   for the listed tools ... so Claude can use them without prompting you for approval"; !`<command>`
//   and ```! blocks run before the skill content is sent to Claude.
// - Claude Code permissions docs (https://code.claude.com/docs/en/permissions): "Bash" and "Bash(*)" match
//   all Bash commands; ":*" is a trailing wildcard; WebFetch(domain:...) scopes WebFetch.
// - Claude Code subagents docs (https://code.claude.com/docs/en/sub-agents): tools "Inherits every tool
//   available to subagents if omitted".

import path from "node:path";
import type { Doc } from "../doc.js";
import { analyse } from "../doc.js";
import { q } from "../escape.js";
import type { Issue } from "../lint.js";
import { UserError } from "../paths.js";
import { fullReadAllowed, SKILL_SCRIPT_MAX_BYTES, skillFolderOf } from "../policy/skill-script.js";
import type { CheckContext, ProjectCheck } from "../project.js";
import { preview } from "../redact.js";
import { binaryKind, scanScript, type ScriptHit, type ScriptSource } from "../scan-script.js";
import { decode, LineIndex } from "../text.js";
import { isOwnUrl, ownProject, type OwnProject } from "./own.js";

/** Walk limits per call. */
const MAX_DEPTH = 8;
const MAX_FILES_PER_SKILL = 500;
const MAX_FILES_TOTAL = 5000;
const MAX_DOC_BYTES = 1024 * 1024;
/** Folders the walk never enters inside a skill (dependencies and caches, not the skill's code). */
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox"]);
const MD_EXT = new Set([".md", ".markdown", ".mdx"]);
const SHELL_EXT = new Set([".sh", ".bash", ".zsh", ".ksh", ".fish"]);

interface Stats {
  folders: number;
  scripts: number;
  docs: number;
  heads: number;
  tooBig: string[];
  refused: string[];
  unread: string[];
  capped: boolean;
  timedOut: boolean;
  total: number;
}

const plural = (n: number, w: string): string => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

function toIssue(h: ScriptHit): Issue {
  return { severity: h.severity, rule: h.ruleId, message: h.message, line: h.line, column: h.column, endLine: h.line, endColumn: h.endColumn };
}

/** A hit held back so that a rule reported once per skill can pick which copy to show. */
interface Held {
  display: string;
  kind: "skill-script" | "markdown" | null; // null: a linted markdown file (SKILL.md)
  lineText: (n: number) => string;
  source: ScriptSource;
  hit: ScriptHit;
}

/** Rules reported once per skill and matched text: the same flag in the code, a comment and the docs is one problem. */
const ONCE_PER_SKILL = new Set(["sec-safety-off"]);

/**
 * A download piped into a shell from the project's own repository or homepage (a skill that tests
 * the project's install script) is a warning, not an error: it is still unreviewed code at run
 * time, but it comes from the same people as the skill. 0.3.0 real-repo review: both error hits
 * of this kind in 71 repos were a release-test skill running its own installer.
 */
function ownSource(h: ScriptHit, own: OwnProject | null): ScriptHit {
  if (!own || h.ruleId !== "sec-remote-exec" || h.severity !== "error" || !h.key || !isOwnUrl(own, h.key)) return h;
  return { ...h, severity: "warning", message: `${h.message} (a warning, not an error: the URL is this project's own repository or site)` };
}

/** Reports hits on a file that is not a linted markdown file; rules in ONCE_PER_SKILL go to held instead. */
function reportExtra(ctx: CheckContext, display: string, kind: "skill-script" | "markdown", text: string, hits: ScriptHit[], source: ScriptSource, held: Held[] | null, own: OwnProject | null = null): void {
  if (!hits.length) return;
  const lines = new LineIndex(text);
  const lineText = (n: number): string => (n >= 1 && n <= lines.count ? lines.line(n - 1) : "");
  for (const raw of hits) {
    const h = ownSource(raw, own);
    if (held && h.key && ONCE_PER_SKILL.has(h.ruleId)) held.push({ display, kind, lineText, source, hit: h });
    else ctx.report(display, toIssue(h), { kind, lineText });
  }
}

const SOURCE_RANK: Record<ScriptSource, number> = { script: 0, "skill-md": 1, "skill-doc": 2, readme: 3 };
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

/** One finding per rule and matched text in a skill: code before comments, scripts before SKILL.md before docs. */
function reportHeld(ctx: CheckContext, held: Held[]): void {
  const groups = new Map<string, Held[]>();
  for (const h of held) {
    const k = `${h.hit.ruleId}\0${h.hit.key}`;
    const g = groups.get(k) ?? [];
    g.push(h);
    groups.set(k, g);
  }
  const comment = (h: Held): number => (/^\s*(?:\/\/|#|\*|\/\*|--|<!--)/.test(h.lineText(h.hit.line)) ? 1 : 0);
  for (const g of groups.values()) {
    g.sort((a, b) => SEVERITY_RANK[a.hit.severity]! - SEVERITY_RANK[b.hit.severity]! || comment(a) - comment(b) || SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
    const best = g[0]!;
    const files = new Set(g.slice(1).map((x) => x.display).filter((d) => d !== best.display));
    const also = g.length > 1 ? ` (also on ${g.length - 1} more ${g.length - 1 === 1 ? "line" : "lines"} of this skill${files.size ? `, in ${files.size === 1 ? "1 other file" : `${files.size} other files`}` : ""})` : "";
    const issue = toIssue({ ...best.hit, message: best.hit.message + also });
    if (best.kind) ctx.report(best.display, issue, { kind: best.kind, lineText: best.lineText });
    else ctx.report(best.display, issue);
  }
}

// ---------------------------------------------------------------------------
// Frontmatter checks

const INTERPRETERS = /^(?:python\d?(?:\.\d{1,2})?|node|nodejs|bash|sh|zsh|dash|ksh|fish|perl|ruby|php|pwsh|powershell|deno|bun|npx|bunx|uvx|eval|exec|env|xargs|sudo|osascript)$/i;
const NETWORK_CMDS = /^(?:curl|wget|nc|ncat|socat)$/i;

/** Splits allowed-tools into entries: by commas or spaces outside parentheses, or a YAML list. */
export function allowedToolEntries(v: unknown): string[] {
  const parts = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
  const out: string[] = [];
  for (const p of parts.slice(0, 200)) {
    let depth = 0;
    let cur = "";
    for (const ch of p.slice(0, 4096)) {
      if (ch === "(") depth++;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === "," || ch === " " || ch === "\t" || ch === "\n")) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

/** Why an allowed-tools entry is too broad, or null. */
export function broadGrant(entry: string): string | null {
  const e = entry.trim();
  if (e === "*") return "every tool";
  const m = /^(Bash|PowerShell|WebFetch)(?:\((.*)\))?$/.exec(e);
  if (!m) return null;
  const tool = m[1]!;
  const spec = (m[2] ?? "").trim();
  if (spec === "" || spec === "*" || spec === ":*") return tool === "WebFetch" ? "WebFetch to any website" : `any ${tool === "Bash" ? "shell" : "PowerShell"} command`;
  if (tool === "WebFetch") return null;
  const word = spec.split(/[\s:]/, 1)[0] ?? "";
  const rest = spec.slice(word.length).replace(/^:/, " ").trim();
  if (rest === "*" || rest === "" || rest === "-c *" || rest === "-e *") {
    if (INTERPRETERS.test(word)) return `any code through ${word}`;
    if (NETWORK_CMDS.test(word)) return `${word} to any host`;
  }
  return null;
}

function checkFrontmatter(ctx: CheckContext, doc: Doc): void {
  const fm = doc.frontmatter;
  const data = fm.present ? fm.data : null;
  const kind = doc.kind.kind;
  if (kind === "skill" || kind === "claude-command") {
    const v = data?.["allowed-tools"];
    if (v === undefined) return;
    const broad = allowedToolEntries(v)
      .map((e) => ({ e, why: broadGrant(e) }))
      .filter((x): x is { e: string; why: string } => x.why !== null);
    if (!broad.length) return;
    const first = broad[0]!;
    const shown = q(preview(broad.map((b) => b.e).join(" "), 60), 200);
    ctx.report(doc.path, {
      severity: "warning",
      rule: "sec-skill-allowed-tools",
      message: `allowed-tools pre-approves ${shown} (${first.why}${broad.length > 1 ? ", and more" : ""}), so during the turn that invokes this ${kind === "skill" ? "skill" : "command"} those calls go ahead without asking you; scope each entry to the commands it needs, for example Bash(git status *) or WebFetch(domain:docs.example.com)`,
      line: fm.keyLines["allowed-tools"] ?? 1,
    });
  } else if (kind === "claude-agent" && data && data["tools"] === undefined) {
    ctx.report(doc.path, {
      severity: "info",
      rule: "sec-skill-allowed-tools",
      message: "No tools list, so this subagent gets every tool the main session has, Bash and MCP tools included; list only the tools it needs in tools",
      line: 1,
      // Most subagent files have no tools list, so this is shown only with extends: strict.
      strictOnly: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Folder walk

interface Entry {
  rel: string;
  name: string;
}

async function listSkill(ctx: CheckContext, dirRel: string, stats: Stats, skillDirs: ReadonlySet<string>): Promise<Entry[]> {
  const out: Entry[] = [];
  const visited = new Set<string>();
  const queue: Array<{ rel: string; depth: number }> = [{ rel: dirRel, depth: 0 }];
  while (queue.length) {
    if (ctx.deadline.expired) {
      stats.timedOut = true;
      break;
    }
    const { rel, depth } = queue.shift()!;
    let listed;
    try {
      listed = await ctx.sandbox.listDir(rel);
    } catch (e) {
      if (e instanceof UserError) stats.refused.push(rel);
      continue;
    }
    if (visited.has(listed.rel)) continue;
    visited.add(listed.rel);
    if (listed.truncated) stats.capped = true;
    const entries = [...listed.entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const child = rel === "." ? e.name : `${rel}/${e.name}`;
      let type = e.type;
      if (type === "symlink") {
        const lex = ctx.sandbox.lexical(child);
        const p = lex ? await ctx.sandbox.probe(child, ctx.sandbox.primary.real).catch(() => null) : null;
        if (!p || p.state !== "ok") {
          stats.refused.push(child);
          continue;
        }
        type = (await ctx.sandbox.listDir(child).then(() => true).catch(() => false)) ? "dir" : "file";
      }
      if (type === "dir") {
        if (SKIP_DIRS.has(e.name) || depth + 1 > MAX_DEPTH) continue;
        if (skillDirs.has(child)) continue; // a nested skill is scanned on its own
        queue.push({ rel: child, depth: depth + 1 });
      } else if (type === "file") {
        if (out.length >= MAX_FILES_PER_SKILL) {
          stats.capped = true;
          continue;
        }
        out.push({ rel: child, name: e.name });
      }
    }
  }
  return out;
}

/** Scans one file in a skill folder. */
async function scanFile(ctx: CheckContext, rel: string, stats: Stats, skillDoc: Doc | null, held: Held[] | null = null, own: OwnProject | null = null): Promise<void> {
  const name = path.posix.basename(rel);
  const lower = name.toLowerCase();
  const ext = path.posix.extname(lower);
  if (lower.startsWith(".env")) return; // never read, not even its first bytes
  if (lower === "skill.md") return; // linted as markdown; its body is scanned from the Doc
  stats.total++;
  const grants = ctx.include as ReadonlySet<string>;

  if (MD_EXT.has(ext)) {
    try {
      const p = await ctx.sandbox.probe(rel, ctx.sandbox.primary.real);
      if ((p.size ?? 0) > MAX_DOC_BYTES) {
        stats.tooBig.push(rel);
        return;
      }
      const f = await ctx.sandbox.open(rel);
      const doc = analyse(f, rel);
      const source: ScriptSource = lower === "readme.md" ? "readme" : "skill-doc";
      stats.docs++;
      const hits = scanScript(doc.text, source, doc.frontmatter.present ? { skipUntilLine: doc.frontmatter.endLine } : {});
      reportExtra(ctx, rel, "markdown", doc.text, hits, source, held, own);
    } catch (e) {
      if (e instanceof UserError) stats.unread.push(rel);
      else throw e;
    }
    void skillDoc;
    return;
  }

  // Everything else: 4 bytes first.
  let head: Uint8Array;
  try {
    head = (await ctx.sandbox.openAs("skill-script", rel, { headBytes: 4, grants })).buf;
  } catch (e) {
    if (e instanceof UserError) {
      (/symlink|outside/i.test(e.message) ? stats.refused : stats.unread).push(rel);
      return;
    }
    throw e;
  }
  stats.heads++;
  const bin = binaryKind(head);
  if (bin) {
    const textExt = ext && !/^\.(?:exe|dll|so|dylib|bin|node|wasm|out|app|elf|o|a|class|jar|pyd)$/.test(ext);
    ctx.report(rel, {
      severity: "warning",
      rule: "sec-skill-binary",
      message: textExt
        ? `This file is named like a text file (${q(ext, 12)}) but is ${bin}; a binary disguised as text cannot be reviewed and runs with your permissions if the skill calls it, so remove it`
        : `This file is ${bin}; nobody can review a binary as text and it runs with your permissions if the skill calls it, so remove it or ship its source instead`,
      line: 1,
    }, { kind: "skill-script", lineText: () => "" });
    return;
  }
  if (!fullReadAllowed(rel)) return;
  const shebang = head[0] === 0x23 && head[1] === 0x21;
  if (ext === "" && !shebang) return;
  let buf: Buffer;
  try {
    buf = (await ctx.sandbox.openAs("skill-script", rel, { grants })).buf;
  } catch (e) {
    if (e instanceof UserError) {
      if (/too large/i.test(e.message)) stats.tooBig.push(rel);
      else stats.unread.push(rel);
      return;
    }
    throw e;
  }
  if (buf.length > SKILL_SCRIPT_MAX_BYTES) {
    stats.tooBig.push(rel);
    return;
  }
  stats.scripts++;
  const { text } = decode(buf);
  const firstLine = text.slice(0, Math.min(text.length, 200)).split(/\r?\n/, 1)[0] ?? "";
  const shell = SHELL_EXT.has(ext) || (shebang && /\b(?:ba|z|k|da|fi)?sh\b/.test(firstLine));
  const hits = scanScript(text, "script", { shell });
  reportExtra(ctx, rel, "skill-script", text, hits, "script", held, own);
}

// ---------------------------------------------------------------------------

function listNote(label: string, items: string[]): string {
  const shown = items.slice(0, 5).map((p) => q(p, 120)).join(", ");
  return `${label}: ${shown}${items.length > 5 ? `, and ${items.length - 5} more` : ""}.`;
}

export const SKILLS_CHECK: ProjectCheck = {
  id: "skills",
  include: "skills",
  ready: true,
  run: async (ctx) => {
    const stats: Stats = { folders: 0, scripts: 0, docs: 0, heads: 0, tooBig: [], refused: [], unread: [], capped: false, timedOut: false, total: 0 };

    // sec-safety-off hits of each skill's SKILL.md, held until its folder is scanned.
    const heldBySkill = new Map<Doc, Held[]>();
    const own = await ownProject(ctx);
    // Frontmatter and bodies of skills, commands and subagents.
    for (const doc of ctx.docs) {
      const kind = doc.kind.kind;
      if (kind !== "skill" && kind !== "claude-command" && kind !== "claude-agent") continue;
      checkFrontmatter(ctx, doc);
      const skip = doc.frontmatter.present ? doc.frontmatter.endLine : -1;
      if (kind === "claude-agent") {
        // A subagent's prompt is not run as commands; only safety-off wording matters, frontmatter included.
        const hits = scanScript(doc.text, "skill-md", {}).filter((h) => h.ruleId === "sec-safety-off");
        for (const h of hits) ctx.report(doc.path, toIssue(h));
        continue;
      }
      const args = doc.frontmatter.data?.["arguments"];
      const argNames = Array.isArray(args) ? args.filter((x): x is string => typeof x === "string") : typeof args === "string" ? args.split(/\s+/).filter(Boolean) : [];
      const hits = scanScript(doc.text, "skill-md", { skipUntilLine: skip, argNames });
      const held: Held[] = [];
      const lineText = (n: number): string => (n >= 1 && n <= doc.lines.count ? doc.lines.line(n - 1) : "");
      for (const raw of hits) {
        const h = ownSource(raw, own);
        if (kind === "skill" && h.key && ONCE_PER_SKILL.has(h.ruleId)) held.push({ display: doc.path, kind: null, lineText, source: "skill-md", hit: h });
        else ctx.report(doc.path, toIssue(h));
      }
      if (kind === "skill") heldBySkill.set(doc, held);
    }

    // Skill folders.
    const skills = ctx.docs.filter((d) => d.kind.kind === "skill" && !d.file.root.extra);
    const skillDirs = new Set(skills.map((d) => path.posix.dirname(d.file.rel)));
    for (const doc of skills) {
      if (ctx.deadline.expired) {
        stats.timedOut = true;
        break;
      }
      if (stats.total >= MAX_FILES_TOTAL) {
        stats.capped = true;
        break;
      }
      stats.folders++;
      const dir = path.posix.dirname(doc.file.rel);
      const held = heldBySkill.get(doc) ?? [];
      heldBySkill.delete(doc);
      for (const e of await listSkill(ctx, dir, stats, skillDirs)) {
        if (stats.total >= MAX_FILES_TOTAL || ctx.deadline.expired) {
          stats.capped ||= stats.total >= MAX_FILES_TOTAL;
          stats.timedOut ||= ctx.deadline.expired;
          break;
        }
        await scanFile(ctx, e.rel, stats, doc, held, own);
      }
      reportHeld(ctx, held);
    }
    // Skills whose folder was not walked (time or file limit): their SKILL.md hits still count.
    for (const held of heldBySkill.values()) reportHeld(ctx, held);

    // Files the caller named (a pre-commit run passes changed scripts).
    for (const t of ctx.otherTargets) {
      const lex = ctx.sandbox.lexical(t);
      if (!lex || lex.root.extra) continue;
      if (!(await skillFolderOf(lex.rel, ctx))) continue;
      ctx.claim(t);
      await scanFile(ctx, lex.rel, stats, null, null, own);
    }

    const scanned = stats.docs + stats.heads;
    if (!stats.folders) ctx.note("Skill scan: no skill folders (folders with a SKILL.md) were found among the linted files.");
    else ctx.note(`Skill scan: ${plural(stats.folders, "skill folder")}, ${plural(stats.scripts, "script")} and ${plural(stats.docs, "markdown file")} read, ${plural(Math.max(0, stats.heads - stats.scripts), "other file")} checked for executable headers (${plural(scanned, "file")} in all).`);
    if (stats.tooBig.length) ctx.note(listNote("Not scanned, over the 1 MB limit for skill files", stats.tooBig));
    if (stats.refused.length) ctx.note(listNote("Not read, a symlink that leaves the project or a refused path", stats.refused));
    if (stats.unread.length) ctx.note(listNote("Could not be read", stats.unread));
    if (stats.capped) ctx.note(`Skill scan stopped early: at most ${MAX_FILES_PER_SKILL} files per skill folder, ${MAX_FILES_TOTAL.toLocaleString("en-US")} files per run and ${MAX_DEPTH} folder levels are checked.`);
    if (stats.timedOut) ctx.note("Skill scan stopped at the time limit; lint fewer skill folders at a time to scan the rest.");
  },
};
