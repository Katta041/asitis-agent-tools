// context_budget: approximate tokens per file and per tool for what loads every session.

import path from "node:path";
import { analyse, type Doc } from "./doc.js";
import { walk, type Deadline } from "./discover.js";
import { VENDOR } from "./limits.js";
import { policyRefusal, UserError, type Sandbox } from "./paths.js";
import { extractImports } from "./scan.js";
import { approxTokens, tokensFromBytes } from "./tokens.js";

export interface BudgetEntry {
  path: string;
  tokens: number;
  note?: string;
  depth?: number;
}

export interface ToolBudget {
  tool: string;
  tokens: number;
  entries: BudgetEntry[];
  warnings: string[];
}

/** Text without block-level HTML comments (Claude Code strips these from CLAUDE.md before loading). Linear. */
export function stripBlockComments(doc: Doc): string {
  const s = doc.text;
  let out = "";
  let pos = 0;
  let copied = 0;
  for (;;) {
    const open = s.indexOf("<!--", pos);
    if (open < 0) break;
    const li = doc.lines.lineOf(open);
    const close = s.indexOf("-->", open + 4);
    const end = close < 0 ? s.length : close + 3;
    pos = end;
    const lineStart = doc.lines.start(li);
    if (!doc.fence[li] && open - lineStart <= 3 && s.slice(lineStart, open).trim() === "") {
      out += s.slice(copied, open);
      copied = end;
    }
    if (close < 0) break;
  }
  return out + s.slice(copied);
}

function bodyTokens(doc: Doc, stripComments: boolean): number {
  const text = stripComments ? stripBlockComments(doc) : doc.text;
  return approxTokens(text);
}

async function openDoc(sandbox: Sandbox, p: string, baseDir?: string): Promise<Doc> {
  const f = await sandbox.open(p, baseDir);
  return analyse(f, sandbox.display(f.real));
}

const MAX_IMPORTS_LISTED = 200;

/** Expands @imports up to four hops, counting each file once. */
export async function expandImports(sandbox: Sandbox, doc: Doc, seen: Set<string>, depth = 1, deadline?: Deadline): Promise<BudgetEntry[]> {
  if (depth > VENDOR.importMaxHops) return [];
  const out: BudgetEntry[] = [];
  const dir = path.dirname(doc.file.real);
  const imports = extractImports(doc.lines, doc.fence, doc.frontmatter.present ? doc.frontmatter.endLine : -1);
  const shown = (p: string): string => (p.length > 200 ? `${p.slice(0, 200)}...` : p);
  let listed = 0;
  for (const im of imports) {
    if (deadline?.expired) break;
    if (++listed > MAX_IMPORTS_LISTED) {
      out.push({ path: `(${imports.length - MAX_IMPORTS_LISTED} more imports in ${doc.path} not listed)`, tokens: 0, depth });
      break;
    }
    if (im.path.startsWith("~")) {
      out.push({ path: `@${shown(im.path)}`, tokens: 0, note: "outside the allowed folder (home), not counted", depth });
      continue;
    }
    const probe = await sandbox.probe(im.path, dir);
    if (probe.state !== "ok" || !probe.real || !probe.rel) {
      out.push({ path: `@${shown(im.path)}`, tokens: 0, note: probe.state === "missing" ? "missing, not counted" : "outside the allowed folder, not counted", depth });
      continue;
    }
    if (seen.has(probe.real)) continue;
    seen.add(probe.real);
    const refusal = policyRefusal(probe.rel);
    if (refusal) {
      const secret = /\.env|settings/i.test(path.basename(probe.rel));
      out.push({
        path: sandbox.display(probe.real),
        tokens: tokensFromBytes(probe.size ?? 0),
        note: secret ? "WARNING: a secrets or settings file is imported into context; estimated from size, not read" : "not markdown; estimated from file size, not read",
        depth,
      });
      continue;
    }
    try {
      const child = await openDoc(sandbox, probe.real);
      out.push({ path: child.path, tokens: bodyTokens(child, true), note: `imported (hop ${depth})`, depth });
      out.push(...(await expandImports(sandbox, child, seen, depth + 1, deadline)));
    } catch (e) {
      out.push({ path: sandbox.display(probe.real), tokens: 0, note: e instanceof UserError ? e.message : "could not be read", depth });
    }
  }
  return out;
}

function skillListingTokens(doc: Doc): number {
  const d = doc.frontmatter.present ? doc.frontmatter.data : null;
  if (!d || d["disable-model-invocation"] === true) return 0;
  const name = String(d["name"] ?? path.posix.basename(path.posix.dirname(doc.file.rel)));
  const listing = `${String(d["description"] ?? "")} ${String(d["when_to_use"] ?? "")}`.slice(0, VENDOR.skillListingChars);
  return approxTokens(`${name}: ${listing}`) + 4;
}

export interface ProjectBudget {
  tools: ToolBudget[];
  files: BudgetEntry[];
  skippedFiles: string[];
  truncated: boolean;
}

export async function projectBudget(sandbox: Sandbox, deadline?: Deadline): Promise<ProjectBudget> {
  const found = await walk(sandbox, deadline ? { deadline } : {});
  const docs: Doc[] = [];
  const skipped: string[] = [];
  for (const f of found.files) {
    if (deadline?.expired) break;
    try {
      docs.push(await openDoc(sandbox, f.abs));
    } catch (e) {
      skipped.push(`${f.path}: ${e instanceof UserError ? e.message : "could not be read"}`);
    }
  }
  const primary = sandbox.primary;
  const atPrimary = (d: Doc): boolean => d.file.root === primary;
  const byRel = (rel: string): Doc | undefined => docs.find((d) => atPrimary(d) && d.file.rel === rel);
  const tools: ToolBudget[] = [];

  // Claude Code
  {
    const entries: BudgetEntry[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    const claudeFiles = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].map(byRel).filter((d): d is Doc => !!d);
    const instr = claudeFiles.length ? claudeFiles : ["AGENTS.md", ".claude/AGENTS.md"].map(byRel).filter((d): d is Doc => !!d);
    for (const d of instr) {
      seen.add(d.file.real);
      const t = bodyTokens(d, true);
      entries.push({ path: d.path, tokens: t, note: claudeFiles.length ? "project instructions (block HTML comments not counted)" : "AGENTS.md (no CLAUDE.md found)" });
      if (d.profile.lines > VENDOR.claudeMdTargetLines) warnings.push(`${d.path} is ${d.profile.lines} lines (target under ${VENDOR.claudeMdTargetLines})`);
      entries.push(...(await expandImports(sandbox, d, seen, 1, deadline)));
    }
    for (const d of docs) {
      if (d.kind.kind === "claude-rule" && d.kind.load === "every-session" && !seen.has(d.file.real)) {
        entries.push({ path: d.path, tokens: bodyTokens(d, true), note: "rule without paths (loads every session)" });
      }
      if (d.kind.kind === "memory-index") {
        const n = Math.min(d.lines.count, VENDOR.memoryIndexLines);
        const end = n < d.lines.count ? d.lines.start(n) : d.text.length;
        const slice = Buffer.from(d.text.slice(0, end)).subarray(0, VENDOR.memoryIndexBytes).toString("utf8");
        entries.push({ path: d.path, tokens: approxTokens(slice), note: "auto memory index (first 200 lines or 25 KB)" });
      }
    }
    let listing = 0;
    let listed = 0;
    for (const d of docs) {
      if (d.kind.kind === "skill" || d.kind.kind === "claude-command" || d.kind.kind === "claude-agent") {
        const t = d.kind.kind === "skill" || d.kind.kind === "claude-command" ? skillListingTokens(d) : approxTokens(String(d.frontmatter.data?.["description"] ?? "")) + 4;
        if (t > 0) { listing += t; listed++; }
      }
    }
    if (listed) entries.push({ path: `(listing of ${listed} skills, commands and subagents)`, tokens: listing, note: "names and descriptions load every session; bodies load on use" });
    if (entries.length) tools.push({ tool: "claude-code", tokens: entries.reduce((a, e) => a + e.tokens, 0), entries, warnings });
  }

  // Codex
  {
    const d = byRel("AGENTS.md");
    if (d) {
      const capped = d.file.buf.subarray(0, VENDOR.codexAgentsMdBytes).toString("utf8");
      const warnings = d.profile.bytes > VENDOR.codexAgentsMdBytes ? [`AGENTS.md is ${d.profile.bytes} bytes; Codex reads only the first ${VENDOR.codexAgentsMdBytes}`] : [];
      tools.push({ tool: "codex", tokens: approxTokens(capped), entries: [{ path: d.path, tokens: approxTokens(capped), note: "root AGENTS.md (nested AGENTS.md load for their folders)" }], warnings });
    }
  }

  // Gemini CLI
  {
    const d = byRel("GEMINI.md");
    if (d) {
      const entries: BudgetEntry[] = [{ path: d.path, tokens: bodyTokens(d, false), note: "root GEMINI.md" }];
      entries.push(...(await expandImports(sandbox, d, new Set([d.file.real]), 1, deadline)));
      tools.push({ tool: "gemini-cli", tokens: entries.reduce((a, e) => a + e.tokens, 0), entries, warnings: [] });
    }
  }

  // Cursor, Copilot, Windsurf, Cline
  const simple: Array<[string, (d: Doc) => boolean, string]> = [
    ["cursor", (d) => (d.kind.kind === "cursor-rule" && d.kind.load === "every-session") || d.kind.kind === "cursor-legacy", "always-applied rule"],
    ["copilot", (d) => d.kind.kind === "copilot-instructions", "repository instructions"],
    ["windsurf", (d) => d.kind.kind === "windsurf-rule" && d.kind.load === "every-session", "always-on rule"],
    ["cline", (d) => d.kind.kind === "cline-rule", "rule"],
  ];
  for (const [tool, pick, note] of simple) {
    const ds = docs.filter(pick);
    if (!ds.length) continue;
    const entries = ds.map((d) => ({ path: d.path, tokens: bodyTokens(d, false), note }));
    tools.push({ tool, tokens: entries.reduce((a, e) => a + e.tokens, 0), entries, warnings: [] });
  }

  const files = docs.map((d) => ({ path: d.path, tokens: approxTokens(d.text), note: `${d.kind.kind}, ${d.kind.load}` })).sort((a, b) => b.tokens - a.tokens);
  return { tools, files, skippedFiles: skipped, truncated: found.truncated };
}

export async function fileBudget(sandbox: Sandbox, p: string, deadline?: Deadline): Promise<{ doc: Doc; tokens: number; imports: BudgetEntry[] }> {
  const doc = await openDoc(sandbox, p);
  const strip = doc.kind.kind === "claude-md" || doc.kind.kind === "agents-md";
  const imports = ["claude-md", "agents-md", "gemini-md", "claude-rule"].includes(doc.kind.kind) ? await expandImports(sandbox, doc, new Set([doc.file.real]), 1, deadline) : [];
  return { doc, tokens: bodyTokens(doc, strip), imports };
}
