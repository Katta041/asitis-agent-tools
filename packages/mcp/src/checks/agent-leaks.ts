// Agent files that should not be in a repo: local-only settings and instructions that no
// .gitignore covers (local-agent-file-not-ignored), and session transcripts or copied agent state
// (agent-transcript-in-repo). Part of the opt-in agent config audit (include "config").
//
// How it reads: sandbox.listDir() for names (no file is opened), files named exactly .gitignore
// to tell what is ignored, and the first 4 KB of files named <uuid>.jsonl to confirm a transcript.
// The policy in policy/agent-config.ts allows exactly those, and only with include "config".
// Local files themselves are never opened: their presence is the finding.
//
// Without git we cannot tell whether a file is tracked, and we do not read .git/info/exclude or
// the global excludes file (Claude Code puts settings.local.json there). So the check runs only
// when the root is the top of a git checkout (a .git entry), messages say "no .gitignore covers
// it", and folders a .gitignore excludes are not walked.
//
// Vendor facts, read 15 November 2026:
// - settings.local.json is personal; Claude Code adds **/.claude/settings.local.json to the global
//   git excludes the first time it writes it, and if you create it by hand you add it to
//   .gitignore yourself: https://code.claude.com/docs/en/settings
// - CLAUDE.local.md: "Add CLAUDE.local.md to your .gitignore": https://code.claude.com/docs/en/memory
// - Subagent memory with scope local lives in .claude/agent-memory-local/<name>/ and "shouldn't be
//   checked into version control": https://code.claude.com/docs/en/sub-agents
// - ~/.claude holds .credentials.json, projects/<project>/<session>.jsonl transcripts (everything
//   that passed through a tool, in plain text), projects/<project>/memory/, history.jsonl,
//   file-history/, shell-snapshots/ and todos/; ~/.claude.json holds account details and
//   per-project state: https://code.claude.com/docs/en/claude-directory
// - Codex keeps sign-in in ~/.codex/auth.json and sessions as
//   ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl, plus history.jsonl:
//   https://learn.chatgpt.com/docs/agent-configuration
// - Gemini CLI keeps OAuth credentials in ~/.gemini/oauth_creds.json and chats, logs and
//   checkpoints under ~/.gemini/tmp/<project hash>/: https://geminicli.com/docs/reference/configuration
// - Aider writes .aider.chat.history.md and .aider.input.history in the repo and adds .aider* to
//   .gitignore: https://aider.chat/docs/config/options.html
// - SpecStory saves AI chats to .specstory/history/ in the project, on purpose, so that one is a
//   note: https://docs.specstory.com/
// - Apiiro (5 November 2026) counted secrets in agent transcripts committed to public repos as part
//   of 2,539 secrets in 1,994 repos: https://apiiro.com/blog/coding-agents-leaking-secrets-github-dont-ask-again

import type { Issue } from "../lint.js";
import { UserError } from "../paths.js";
import { CAPS } from "../limits.js";
import { TRANSCRIPT_HEAD_BYTES, TRANSCRIPT_NAME } from "../policy/agent-config.js";
import type { CheckContext } from "../project.js";
import { IgnoreTree, parseGitignore } from "../gitignore.js";
import { q } from "../escape.js";

/** Folders the walk never enters (dependencies, build output, virtualenvs). */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".turbo",
  ".cache", ".venv", "venv", "__pycache__", ".tox", "vendor", ".idea", ".gradle", ".terraform",
]);

/** Findings of each rule, at most; the rest are counted in a note. */
const MAX_FINDINGS = 25;
/** Transcript-named files whose head is read, at most. */
const MAX_HEAD_READS = 40;

// ---------------------------------------------------------------------------------------------
// What counts

export interface LocalFile {
  /** For the message. */
  what: string;
  /** The .gitignore line to suggest. */
  pattern: string;
  /** Sign-in credentials: an error, not a warning. */
  credential: boolean;
  /** Report once per folder (agent-memory-local): the folder path. */
  group?: string;
}

/** Copies a user made by hand: settings.local.json.bak, settings.local.json~, #settings.local.json#. Templates are meant to be shared. */
const LOCAL_SETTINGS_COPY = /^#?settings\.local\.json(?:[.~_-][^/]{0,60})?#?$/;
const TEMPLATE_SUFFIX = /(?:template|example|sample|dist|default|defaults|schema|md)$/i;

/** A local-only agent file at this root-relative path, or null. */
export function localAgentFile(rel: string): LocalFile | null {
  const parts = rel.split("/");
  const base = parts[parts.length - 1]!;
  const parent = parts.length > 1 ? parts[parts.length - 2]! : "";
  if (parent === ".claude") {
    if (base === "settings.local.json") {
      return { what: "personal Claude Code settings, where \"Yes, and don't ask again\" saves each approved command in full", pattern: "**/.claude/settings.local.json", credential: false };
    }
    if (LOCAL_SETTINGS_COPY.test(base) && !TEMPLATE_SUFFIX.test(base)) {
      return { what: "a copy of personal Claude Code settings, where \"Yes, and don't ask again\" saves each approved command in full", pattern: "**/.claude/settings.local.json*", credential: false };
    }
    if (base === ".credentials.json") return { what: "Claude Code sign-in credentials", pattern: "**/.claude/.credentials.json", credential: true };
  }
  if (base === "CLAUDE.local.md") return { what: "personal Claude Code instructions, which the Claude Code docs say to keep out of git", pattern: "CLAUDE.local.md", credential: false };
  if (base === ".claude.json") return { what: "Claude Code's own state file (account details, MCP servers and per-project history)", pattern: ".claude.json", credential: true };
  if (parent === ".codex" && base === "auth.json") return { what: "Codex sign-in credentials", pattern: "**/.codex/auth.json", credential: true };
  if (parent === ".gemini" && base === "oauth_creds.json") return { what: "Gemini CLI sign-in credentials", pattern: "**/.gemini/oauth_creds.json", credential: true };
  const mem = parts.indexOf("agent-memory-local");
  if (mem > 0 && parts[mem - 1] === ".claude" && mem < parts.length - 1) {
    return { what: "subagent memory with the local scope, which the Claude Code docs say should not be checked in", pattern: "**/.claude/agent-memory-local/", credential: false, group: parts.slice(0, mem + 1).join("/") };
  }
  return null;
}

export interface TranscriptSignal {
  /** For the message: "Claude Code session transcripts". */
  what: string;
  /** Findings group by this folder or file. */
  group: string;
  pattern: string;
  /** A note rather than a warning (SpecStory saves chats in the repo on purpose). */
  note?: boolean;
  /** Only a candidate: confirm with the first bytes before reporting. */
  needsHead?: boolean;
  /** group names a set of files ("app/.aider*"), not a folder. */
  files?: boolean;
}

/**
 * Folders that hold samples on purpose: a session parser's test fixtures, a template's example
 * CLAUDE.local.md. 0.4.0 corpus: the one transcript hit that was not worth fixing was a fixture.
 */
const SAMPLE_DIRS = new Set(["fixtures", "__fixtures__", "fixture", "testdata", "test-data", "test", "tests", "__tests__", "spec", "specs", "samples", "sample", "examples", "example", "templates", "template", "demo", "demos", "mocks", "__mocks__"]);

/** True when a folder on the path (not the file itself) is a test, fixture, example or template folder. */
export function inSampleDir(rel: string): boolean {
  const parts = rel.split("/");
  for (let k = 0; k < parts.length - 1; k++) if (SAMPLE_DIRS.has(parts[k]!.toLowerCase())) return true;
  return false;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CODEX_ROLLOUT = new RegExp(`^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-${UUID}\\.jsonl$`);
/** ~/.claude/projects/<project>: the working folder with every non-alphanumeric character turned into "-". */
const ENCODED_PROJECT = /^(?:[A-Za-z]-)?-(?:Users|home|root|private|tmp|var|mnt|opt|srv|workspaces?|data|app|code|Volumes)-[A-Za-z0-9-]{1,240}$/;
const CLAUDE_TODO = new RegExp(`^${UUID}-agent-${UUID}\\.json$`);
const UUID_DIR = new RegExp(`^${UUID}$`);
const GEMINI_HASH = /^[0-9a-f]{64}$/;

/** A transcript or copied agent state at this root-relative path, or null. */
export function transcriptSignal(rel: string): TranscriptSignal | null {
  const parts = rel.split("/");
  const n = parts.length;
  const base = parts[n - 1]!;
  const dirOf = (k: number): string => parts.slice(0, k).join("/");
  // A copy of ~/.claude/projects, whole or one project of it.
  const proj = findPair(parts, ".claude", "projects");
  if (proj !== -1 && proj + 2 < n) {
    // One finding for the whole copy: a backup of ~/.claude can hold hundreds of project folders.
    return { what: "Claude Code session data copied from ~/.claude/projects", group: dirOf(proj + 2), pattern: "**/.claude/projects/" };
  }
  for (let k = 0; k < n - 1; k++) {
    if (!ENCODED_PROJECT.test(parts[k]!)) continue;
    if (k === n - 2 && TRANSCRIPT_NAME.test(base)) return { what: "Claude Code session transcripts", group: dirOf(k + 1), pattern: `${parts[k]}/` };
    if (parts[k + 1] === "memory" && /\.md$/i.test(base)) return { what: "Claude Code auto memory copied from ~/.claude/projects", group: dirOf(k + 2), pattern: `${parts[k]}/` };
    if (k + 1 < n - 1 && UUID_DIR.test(parts[k + 1]!) && (parts[k + 2] === "subagents" || parts[k + 2] === "tool-results")) {
      return { what: "Claude Code session data", group: dirOf(k + 1), pattern: `${parts[k]}/` };
    }
  }
  if (CODEX_ROLLOUT.test(base)) {
    // sessions/YYYY/MM/DD/rollout-...: group at the folder above the dates.
    let k = n - 1;
    while (k > 0 && /^\d{2,4}$/.test(parts[k - 1]!) && n - 1 - k < 3) k--;
    return { what: "Codex session transcripts", group: dirOf(k) || ".", pattern: "rollout-*.jsonl" };
  }
  const parent = n > 1 ? parts[n - 2]! : "";
  if (base === "history.jsonl" && (parent === ".claude" || parent === ".codex")) {
    return { what: `${parent === ".claude" ? "Claude Code" : "Codex"} prompt history`, group: rel, pattern: `**/${parent}/history.jsonl` };
  }
  const dot = parts.lastIndexOf(".claude");
  if (dot !== -1 && dot < n - 1) {
    const sub = parts[dot + 1]!;
    if (sub === "file-history" && dot + 2 < n - 1 && UUID_DIR.test(parts[dot + 2]!)) return { what: "Claude Code file snapshots copied from ~/.claude/file-history", group: dirOf(dot + 2), pattern: "**/.claude/file-history/" };
    if (sub === "shell-snapshots" && /^snapshot-[A-Za-z0-9_.-]{1,120}\.sh$/.test(base)) return { what: "Claude Code shell snapshots copied from ~/.claude/shell-snapshots", group: dirOf(dot + 2), pattern: "**/.claude/shell-snapshots/" };
    if (sub === "todos" && dot + 2 === n - 1 && CLAUDE_TODO.test(base)) return { what: "Claude Code session task lists copied from ~/.claude/todos", group: dirOf(dot + 2), pattern: "**/.claude/todos/" };
  }
  const gem = findPair(parts, ".gemini", "tmp");
  if (gem !== -1 && gem + 2 < n && GEMINI_HASH.test(parts[gem + 2]!) && gem + 3 < n) {
    return { what: "Gemini CLI chats, logs or checkpoints copied from ~/.gemini/tmp", group: dirOf(gem + 3), pattern: "**/.gemini/tmp/" };
  }
  if (/^\.aider\.(?:chat\.history\.md|input\.history|llm\.history)$/.test(base)) return { what: "Aider chat history", group: `${dirOf(n - 1) || "."}/.aider*`, pattern: ".aider*", files: true };
  const spec = parts.indexOf(".specstory");
  if (spec !== -1 && parts[spec + 1] === "history" && spec + 2 === n - 1 && /\.md$/i.test(base)) {
    return { what: "SpecStory saved AI chats", group: dirOf(spec + 2), pattern: ".specstory/history/", note: true };
  }
  if (TRANSCRIPT_NAME.test(base)) return { what: "Claude Code session transcripts", group: dirOf(n - 1) || base, pattern: "", needsHead: true };
  return null;
}

function findPair(parts: string[], a: string, b: string): number {
  for (let k = 0; k + 1 < parts.length; k++) if (parts[k] === a && parts[k + 1] === b) return k;
  return -1;
}

/** The first bytes of a Claude Code transcript: JSON lines with a sessionId and the message tree fields. */
export function looksLikeTranscript(head: string): boolean {
  const first = head.trimStart();
  if (!first.startsWith("{")) return false;
  return new RegExp(`"sessionId"\\s{0,4}:\\s{0,4}"${UUID}"`).test(head) && /"(?:parentUuid|leafUuid|cwd|isSidechain|userType)"\s{0,4}:/.test(head);
}

// ---------------------------------------------------------------------------------------------
// The walk

interface Hit {
  rel: string;
}

export async function auditLeakFiles(ctx: CheckContext): Promise<void> {
  const sb = ctx.sandbox;
  const root = sb.primary.real;
  // Only at the top of a git checkout: elsewhere a .gitignore above the root may cover the file.
  const git = await sb.probe(".git", root);
  if (git.state !== "ok") return;
  const tree = new IgnoreTree();
  const loaded = new Set<string>();
  let gitignoreProblem = "";
  const loadIgnore = async (dir: string): Promise<void> => {
    if (loaded.has(dir)) return;
    loaded.add(dir);
    const rel = dir ? `${dir}/.gitignore` : ".gitignore";
    const p = await sb.probe(rel, root);
    if (p.state !== "ok") return;
    try {
      const f = await sb.openAs("agent-config", rel, { grants: ctx.include });
      tree.add(dir, parseGitignore(new TextDecoder("utf-8").decode(f.buf)));
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      gitignoreProblem ||= `${rel}: not read (${e.message.replace(/\.$/, "")})`;
    }
  };

  const local = new Map<string, { file: LocalFile; rel: string }>();
  const transcripts = new Map<string, { sig: TranscriptSignal; first: string; count: number }>();
  const heads: Hit[] = [];
  let cut = "";

  const consider = (rel: string): void => {
    if (inSampleDir(rel)) return;
    const lf = localAgentFile(rel);
    if (lf) {
      const key = lf.group ?? rel;
      if (!local.has(key)) local.set(key, { file: lf, rel });
      return;
    }
    const sig = transcriptSignal(rel);
    if (!sig) return;
    if (sig.needsHead) {
      if (heads.length < MAX_HEAD_READS) heads.push({ rel });
      return;
    }
    const g = transcripts.get(sig.group);
    if (g) g.count++;
    else transcripts.set(sig.group, { sig, first: rel, count: 1 });
  };

  if (ctx.discovered) {
    const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];
    let seen = 0;
    while (queue.length) {
      if (ctx.deadline.expired) {
        cut = "the time limit";
        break;
      }
      const { rel, depth } = queue.shift()!;
      let entries: Array<{ name: string; type: string }>;
      try {
        entries = (await sb.listDir(rel || ".", root)).entries;
      } catch {
        continue; // gone, unreadable or refused: nothing to look at
      }
      // A nested repository (a vendored clone, a submodule) has its own rules: skip it.
      if (rel && entries.some((e) => e.name === ".git")) continue;
      if (entries.some((e) => e.name === ".gitignore" && e.type === "file")) await loadIgnore(rel);
      else loaded.add(rel);
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        if (++seen > CAPS.walkMaxEntries) {
          cut = `${CAPS.walkMaxEntries.toLocaleString("en-US")} folder entries`;
          queue.length = 0;
          break;
        }
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.type === "dir") {
          if (SKIP_DIRS.has(e.name)) continue;
          if (tree.dirExcluded(childRel)) continue;
          if (depth + 1 > CAPS.walkMaxDepth) continue;
          queue.push({ rel: childRel, depth: depth + 1 });
          continue;
        }
        if (e.type !== "file" && e.type !== "symlink") continue;
        if (!localAgentFile(childRel) && !transcriptSignal(childRel)) continue;
        // Ignored, or re-included on purpose with a "!" line: either way someone decided.
        if (tree.ignored(childRel) || tree.decided(childRel)) continue;
        consider(childRel);
      }
    }
  } else {
    // Named files (a pre-commit run passes what is being committed).
    const named: string[] = [];
    for (const d of ctx.docs) if (d.file.root === sb.primary) named.push(d.file.rel);
    for (const t of ctx.otherTargets) {
      const lex = sb.lexical(t);
      if (!lex || lex.root !== sb.primary || !lex.rel) continue;
      if (localAgentFile(lex.rel) || transcriptSignal(lex.rel)) {
        named.push(lex.rel);
        ctx.claim(t);
      }
    }
    for (const rel of named) {
      if (!localAgentFile(rel) && !transcriptSignal(rel)) continue;
      const parts = rel.split("/");
      for (let d = 0; d < parts.length; d++) await loadIgnore(parts.slice(0, d).join("/"));
      if (tree.ignored(rel) || tree.decided(rel)) continue;
      consider(rel);
    }
  }

  // Confirm bare <uuid>.jsonl files by their first bytes.
  for (const h of heads) {
    if (ctx.deadline.expired) break;
    let head: string;
    try {
      const f = await sb.openAs("agent-config", h.rel, { grants: ctx.include, headBytes: TRANSCRIPT_HEAD_BYTES });
      head = new TextDecoder("utf-8").decode(f.buf);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      continue;
    }
    if (!looksLikeTranscript(head)) continue;
    const sig = transcriptSignal(h.rel)!;
    const g = transcripts.get(sig.group);
    if (g) g.count++;
    else transcripts.set(sig.group, { sig: { ...sig, pattern: sig.group ? `${sig.group}/*.jsonl` : "*.jsonl" }, first: h.rel, count: 1 });
  }

  reportLocal(ctx, [...local.values()]);
  reportTranscripts(ctx, [...transcripts.values()]);
  if (gitignoreProblem) ctx.note(`Leak scan: ${gitignoreProblem}; files it would cover may be reported.`);
  if (cut) ctx.note(`Leak scan: the folder walk stopped at ${cut}, so some local agent files and transcripts may not be reported.`);
}

const shown = (rel: string): string => (/^[A-Za-z0-9_./@+*-]{1,200}$/.test(rel) ? rel : q(rel, 120));

function fileIssue(rel: string, issue: Omit<Issue, "line" | "column" | "endLine" | "endColumn" | "fingerprintText">): Issue {
  // Not a linted file: point at line 1 and fingerprint the path, not file content.
  return { ...issue, line: 1, column: 1, endLine: 1, endColumn: 1, fingerprintText: `${issue.rule}:${rel}` };
}

function reportLocal(ctx: CheckContext, found: Array<{ file: LocalFile; rel: string }>): void {
  found.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  for (const { file, rel } of found.slice(0, MAX_FINDINGS)) {
    const at = file.group ?? rel;
    const where = file.group ? `${shown(at)}/ (${shown(rel)} and anything else in it)` : shown(rel);
    const message = file.credential
      ? `${where} is ${file.what}, and no .gitignore in the repo covers it; anyone who can read the repo can sign in as its owner. Sign out or revoke it, delete it from the repo, and add "${file.pattern}" to .gitignore`
      : `${where} holds ${file.what}, and no .gitignore in the repo covers it, so a clone, a sandbox or a second machine commits it; add "${file.pattern}" to .gitignore, and if git already tracks it, run git rm --cached on it and rotate any password or token it held`;
    ctx.report(rel, fileIssue(rel, { severity: file.credential ? "error" : "warning", rule: "local-agent-file-not-ignored", message }), { kind: "agent-config", lineText: () => "" });
  }
  if (found.length > MAX_FINDINGS) ctx.note(`Leak scan: ${found.length - MAX_FINDINGS} more local agent files are not covered by .gitignore and were not listed.`);
}

function reportTranscripts(ctx: CheckContext, found: Array<{ sig: TranscriptSignal; first: string; count: number }>): void {
  found.sort((a, b) => (a.first < b.first ? -1 : 1));
  for (const { sig, first, count } of found.slice(0, MAX_FINDINGS)) {
    // Not the first file name: session files are named by UUID, which redaction masks anyway.
    const many = count > 1 ? ` (${count} files)` : "";
    const what = sig.files ? `${shown(sig.group.replace(/^\.\//, ""))}${many}` : sig.group && sig.group !== first ? `${shown(sig.group === "." ? "./" : `${sig.group}/`)}${many}` : `${shown(first)}`;
    const message = sig.note
      ? `${what} holds ${sig.what}. Saved chats keep whatever was pasted or printed, keys included; read them for secrets before pushing, or add "${sig.pattern}" to .gitignore`
      : `${what} holds ${sig.what}, and no .gitignore in the repo covers it. Transcripts keep everything the agent saw (file contents, command output, pasted text), so check them for secrets, rotate what you find, then remove them from the repo${sig.pattern ? ` and add "${sig.pattern}" to .gitignore` : ""}`;
    ctx.report(first, fileIssue(first, { severity: sig.note ? "info" : "warning", rule: "agent-transcript-in-repo", message }), { kind: "agent-config", lineText: () => "" });
  }
  if (found.length > MAX_FINDINGS) ctx.note(`Leak scan: ${found.length - MAX_FINDINGS} more folders with agent transcripts were not listed.`);
}
